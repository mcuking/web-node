// wn_histogram.cc — `perf_hooks` 直方图的 native 层（native → WASM，M117）。
//
// 背后是**真 `deps/histogram`**（HdrHistogram 的 C 实现，Node 上游同一份源码）编出的
// wasm 模块；本文件是它上面的薄封装，把 Node `src/histogram.cc`（+ `histogram-inl.h`）
// 里的**算法**逐条照搬过来（统计量、CBOR 导出/导入、EWMA、各种检验），只是把
// V8/Node 的胶水（`FunctionCallbackInfo`、`BaseObject`、`RwLock`）换成一组给 JS 用的
// C ABI。取巧之处为零：分位数、均值/标准差、导出字节都由上游 C 与这份逐行移植产生。
//
// ABI 约定：
//   · 句柄是 32 位不透明整数（wasm32 里就是 `Histogram*`），0 表示失败/空。
//   · i64 参数/返回值在 JS 侧是 BigInt（WebAssembly JS API 的规则）。
//   · 变长结果（分位表、桶表、CBOR 字节、定长结构体）写进模块自己的 scratch
//     缓冲区，再通过 `*_ptr()` 把地址交给 JS 读——避免 JS 往 wasm 里传指针。
//
// 有意偏离（见 DEVLOG）：Node 用 `uv_hrtime()` 驱动 `recordDelta`，这里由 JS 传入
// 单调时钟（纳秒）；`RwLock` 省去（单线程 wasm，没有并发读者）。

#include <hdr/hdr_histogram.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>
#include <numbers>
#include <utility>
#include <vector>

#define WN_EXPORT(name) \
  extern "C" __attribute__((export_name(#name), used)) auto name

namespace {

// ---------------------------------------------------------------------------
// 统计辅助函数 —— 逐行移置 `src/histogram.cc`（Numerical Recipes 6.4 的连分式）
// ---------------------------------------------------------------------------

// Regularized incomplete beta I_x(a, b) 的连分式（Lentz 修正法）。
double BetaContinuedFraction(double a, double b, double x) {
  constexpr double FPMIN = 1e-30;
  constexpr int MAXIT = 200;
  constexpr double EPS = 3e-12;

  double qab = a + b;
  double qap = a + 1.0;
  double qam = a - 1.0;
  double c = 1.0;
  double d = 1.0 - qab * x / qap;
  if (std::fabs(d) < FPMIN) d = FPMIN;
  d = 1.0 / d;
  double h = d;

  for (int m = 1; m <= MAXIT; m++) {
    int m2 = 2 * m;
    // Even step.
    double aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1.0 + aa * d;
    if (std::fabs(d) < FPMIN) d = FPMIN;
    c = 1.0 + aa / c;
    if (std::fabs(c) < FPMIN) c = FPMIN;
    d = 1.0 / d;
    h *= d * c;
    // Odd step.
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1.0 + aa * d;
    if (std::fabs(d) < FPMIN) d = FPMIN;
    c = 1.0 + aa / c;
    if (std::fabs(c) < FPMIN) c = FPMIN;
    d = 1.0 / d;
    double del = d * c;
    h *= del;
    if (std::fabs(del - 1.0) <= EPS) break;
  }
  return h;
}

// 正则化不完全贝塔函数 I_x(a, b)：Beta(a,b) 随机变量 <= x 的概率。
double RegularizedIncompleteBeta(double a, double b, double x) {
  if (x <= 0.0) return 0.0;
  if (x >= 1.0) return 1.0;

  double ln_front = std::lgamma(a + b) - std::lgamma(a) - std::lgamma(b) +
                    a * std::log(x) + b * std::log(1.0 - x);
  double bt = std::exp(ln_front);

  if (x < (a + 1.0) / (a + b + 2.0)) {
    return bt * BetaContinuedFraction(a, b, x) / a;
  }
  return 1.0 - bt * BetaContinuedFraction(b, a, 1.0 - x) / b;
}

// 标准正态 CDF：Phi(x) = P(Z <= x)。
double NormalCdf(double x) {
  return 0.5 * std::erfc(-x * std::numbers::sqrt2 / 2.0);
}

// Student's t 分布 CDF：自由度为 df 时 P(T <= t)。
double StudentTCdf(double t, double df) {
  double squared = t * t;
  double denominator = df + squared;
  if (squared < df) {
    double x = squared / denominator;
    double ibeta = RegularizedIncompleteBeta(0.5, df / 2.0, x);
    return t >= 0.0 ? 0.5 + 0.5 * ibeta : 0.5 - 0.5 * ibeta;
  }

  double x = df / denominator;
  double ibeta = RegularizedIncompleteBeta(df / 2.0, 0.5, x);
  return t >= 0.0 ? 1.0 - 0.5 * ibeta : 0.5 * ibeta;
}

// 上尾概率 p 对应的正 Student t 分位数（用下尾避免 p 接近 1 时丢精度）。
double StudentTUpperQuantile(double p, double df) {
  double lo = 0.0;
  double hi = 1.0;
  while (StudentTCdf(-hi, df) > p) hi *= 2.0;

  for (int i = 0; i < 100; i++) {
    double mid = (lo + hi) / 2.0;
    if (StudentTCdf(-mid, df) > p) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2.0;
}

// 二项分布 CDF：X ~ Binomial(n, p) 时 P(X <= k)。用 P(X <= k) = I_{1-p}(n-k, k+1)。
double BinomialCdf(int64_t k, int64_t n, double p) {
  if (k < 0) return 0.0;
  if (k >= n) return 1.0;
  return RegularizedIncompleteBeta(
      static_cast<double>(n - k), static_cast<double>(k + 1), 1.0 - p);
}

// ---------------------------------------------------------------------------
// 极简 CBOR 编解码（RFC 8949）—— 逐行移置 `src/histogram.cc`
// ---------------------------------------------------------------------------

constexpr uint8_t kCborUint = 0 << 5;   // Major 0: 无符号整数
constexpr uint8_t kCborArray = 4 << 5;  // Major 4: 数组
constexpr uint8_t kCborMap = 5 << 5;    // Major 5: map
constexpr uint8_t kCborFloat64 = 0xfb;  // Major 7, additional 27

void CborWriteUint(std::vector<uint8_t>& out, uint8_t major, uint64_t val) {
  if (val <= 23) {
    out.push_back(major | static_cast<uint8_t>(val));
  } else if (val <= 0xff) {
    out.push_back(major | 24);
    out.push_back(static_cast<uint8_t>(val));
  } else if (val <= 0xffff) {
    out.push_back(major | 25);
    out.push_back(static_cast<uint8_t>(val >> 8));
    out.push_back(static_cast<uint8_t>(val));
  } else if (val <= 0xffffffff) {
    out.push_back(major | 26);
    out.push_back(static_cast<uint8_t>(val >> 24));
    out.push_back(static_cast<uint8_t>(val >> 16));
    out.push_back(static_cast<uint8_t>(val >> 8));
    out.push_back(static_cast<uint8_t>(val));
  } else {
    out.push_back(major | 27);
    out.push_back(static_cast<uint8_t>(val >> 56));
    out.push_back(static_cast<uint8_t>(val >> 48));
    out.push_back(static_cast<uint8_t>(val >> 40));
    out.push_back(static_cast<uint8_t>(val >> 32));
    out.push_back(static_cast<uint8_t>(val >> 24));
    out.push_back(static_cast<uint8_t>(val >> 16));
    out.push_back(static_cast<uint8_t>(val >> 8));
    out.push_back(static_cast<uint8_t>(val));
  }
}

void CborWriteFloat64(std::vector<uint8_t>& out, double val) {
  out.push_back(kCborFloat64);
  uint64_t bits;
  std::memcpy(&bits, &val, sizeof(bits));
  // 网络字节序（大端）。
  out.push_back(static_cast<uint8_t>(bits >> 56));
  out.push_back(static_cast<uint8_t>(bits >> 48));
  out.push_back(static_cast<uint8_t>(bits >> 40));
  out.push_back(static_cast<uint8_t>(bits >> 32));
  out.push_back(static_cast<uint8_t>(bits >> 24));
  out.push_back(static_cast<uint8_t>(bits >> 16));
  out.push_back(static_cast<uint8_t>(bits >> 8));
  out.push_back(static_cast<uint8_t>(bits));
}

bool CborReadUint(const uint8_t*& p, const uint8_t* end, uint64_t* val) {
  if (p >= end) return false;
  uint8_t info = *p++ & 0x1f;
  if (info <= 23) {
    *val = info;
  } else if (info == 24) {
    if (p + 1 > end) return false;
    *val = p[0];
    p += 1;
  } else if (info == 25) {
    if (p + 2 > end) return false;
    *val = (static_cast<uint64_t>(p[0]) << 8) | p[1];
    p += 2;
  } else if (info == 26) {
    if (p + 4 > end) return false;
    *val = (static_cast<uint64_t>(p[0]) << 24) |
           (static_cast<uint64_t>(p[1]) << 16) |
           (static_cast<uint64_t>(p[2]) << 8) | p[3];
    p += 4;
  } else if (info == 27) {
    if (p + 8 > end) return false;
    *val = (static_cast<uint64_t>(p[0]) << 56) |
           (static_cast<uint64_t>(p[1]) << 48) |
           (static_cast<uint64_t>(p[2]) << 40) |
           (static_cast<uint64_t>(p[3]) << 32) |
           (static_cast<uint64_t>(p[4]) << 24) |
           (static_cast<uint64_t>(p[5]) << 16) |
           (static_cast<uint64_t>(p[6]) << 8) | p[7];
    p += 8;
  } else {
    return false;  // 不定长或保留编码，不支持。
  }
  return true;
}

bool CborReadFloat64(const uint8_t*& p, const uint8_t* end, double* val) {
  if (p >= end || *p != kCborFloat64) return false;
  p++;
  if (p + 8 > end) return false;
  uint64_t bits = (static_cast<uint64_t>(p[0]) << 56) |
                  (static_cast<uint64_t>(p[1]) << 48) |
                  (static_cast<uint64_t>(p[2]) << 40) |
                  (static_cast<uint64_t>(p[3]) << 32) |
                  (static_cast<uint64_t>(p[4]) << 24) |
                  (static_cast<uint64_t>(p[5]) << 16) |
                  (static_cast<uint64_t>(p[6]) << 8) | p[7];
  p += 8;
  std::memcpy(val, &bits, sizeof(*val));
  return true;
}

bool CborReadNumber(const uint8_t*& p, const uint8_t* end, double* val) {
  if (p >= end) return false;
  if (*p == kCborFloat64) return CborReadFloat64(p, end, val);
  uint64_t u;
  if (!CborReadUint(p, end, &u)) return false;
  *val = static_cast<double>(u);
  return true;
}

// Histogram 导出格式版本。
constexpr uint64_t kExportVersion = 1;

// 顶层 map 的整数键。
constexpr uint64_t kKeyVersion = 0;
constexpr uint64_t kKeyLowest = 1;
constexpr uint64_t kKeyHighest = 2;
constexpr uint64_t kKeyFigures = 3;
constexpr uint64_t kKeyTotalCount = 4;
constexpr uint64_t kKeyMin = 5;
constexpr uint64_t kKeyMax = 6;
constexpr uint64_t kKeyNormOffset = 7;
constexpr uint64_t kKeyConvRatio = 8;
constexpr uint64_t kKeyCountsLen = 9;
constexpr uint64_t kKeyCounts = 10;
constexpr uint64_t kKeyEwma = 11;

// 内部记录（对齐 Node 的 `Histogram::Options` / 私有字段）。
struct Options {
  int64_t lowest = 1;
  int64_t highest = std::numeric_limits<int64_t>::max();
  int figures = 3;
  double half_life = 0;  // EWMA 半衰期（样本数）。0 = 关。
  int64_t threshold = 0; // SLO 阈值。与 half_life 同开时跟踪超阈值的 EWMA 错误率。
};

// ---------------------------------------------------------------------------
// Histogram —— 逐行移置 Node `src/histogram.h` / `histogram-inl.h` 的算法
// ---------------------------------------------------------------------------

class Histogram {
 public:
  struct MeanCIResult {
    double mean;
    double lower;
    double upper;
  };
  struct WelchTestResult {
    double t_statistic;
    double degrees_of_freedom;
    double p_value;
    double ci_lower;
    double ci_upper;
  };
  struct MannWhitneyResult {
    double u_statistic;
    double z_score;
    double p_value;
  };
  struct PercentileCIResult {
    int64_t value;
    int64_t lower;
    int64_t upper;
  };

  hdr_histogram* h = nullptr;
  Options opts;
  uint64_t prev = 0;
  size_t exceeds = 0;
  // EWMA 状态（ewma_alpha > 0 时激活）。
  double ewma_alpha = 0;
  double ewma_mean = 0;
  double ewma_variance = 0;
  bool ewma_initialized = false;
  // SLO 错误率 EWMA（threshold > 0 且 ewma_alpha > 0 时激活）。
  int64_t threshold = 0;
  double ewma_error_rate = 0;

  static Histogram* Create(const Options& options) {
    hdr_histogram* hd = nullptr;
    if (hdr_init(options.lowest, options.highest, options.figures, &hd) != 0) {
      return nullptr;
    }
    auto* self = new Histogram();
    self->h = hd;
    self->opts = options;
    // alpha = 1 - 2^(-1/halfLife)。halfLife <= 0 时 EWMA 关闭。
    if (options.half_life > 0) {
      self->ewma_alpha =
          1.0 - std::exp(-std::log(2.0) / options.half_life);
    }
    self->threshold = options.threshold;
    return self;
  }

  ~Histogram() {
    if (h != nullptr) hdr_close(h);
  }

  bool IsCompatible(const Histogram& other) const {
    return h->counts_len == other.h->counts_len &&
           h->lowest_discernible_value == other.h->lowest_discernible_value &&
           h->highest_trackable_value == other.h->highest_trackable_value &&
           h->significant_figures == other.h->significant_figures;
  }

  void UpdateEwma(double value) {
    if (ewma_alpha <= 0) return;
    if (!ewma_initialized) {
      ewma_mean = value;
      ewma_variance = 0;
      ewma_initialized = true;
      if (threshold > 0) {
        ewma_error_rate = (value > static_cast<double>(threshold)) ? 1.0 : 0.0;
      }
      return;
    }
    double diff = value - ewma_mean;
    ewma_mean += ewma_alpha * diff;
    ewma_variance =
        (1.0 - ewma_alpha) * (ewma_variance + ewma_alpha * diff * diff);

    if (threshold > 0) {
      double exceeded = (value > static_cast<double>(threshold)) ? 1.0 : 0.0;
      ewma_error_rate += ewma_alpha * (exceeded - ewma_error_rate);
    }
  }

  bool Record(int64_t value) {
    bool recorded = hdr_record_value(h, value);
    if (!recorded) {
      exceeds++;
    } else {
      UpdateEwma(static_cast<double>(value));
    }
    return recorded;
  }

  bool RecordCorrected(int64_t value, int64_t expected_interval) {
    bool recorded = hdr_record_corrected_value(h, value, expected_interval);
    if (!recorded) {
      exceeds++;
    } else {
      UpdateEwma(static_cast<double>(value));
    }
    return recorded;
  }

  uint64_t RecordDelta(uint64_t now) {
    int64_t delta = 0;
    if (prev > 0) {
      delta = static_cast<int64_t>(now - prev);
      if (!hdr_record_value(h, delta)) {
        exceeds++;
      } else {
        UpdateEwma(static_cast<double>(delta));
      }
    }
    prev = now;
    return static_cast<uint64_t>(delta);
  }

  void Reset() {
    hdr_reset(h);
    exceeds = 0;
    prev = 0;
    ewma_mean = 0;
    ewma_variance = 0;
    ewma_error_rate = 0;
    ewma_initialized = false;
  }

  double Add(const Histogram& other) {
    exceeds += other.exceeds;
    if (other.prev > prev) prev = other.prev;
    return static_cast<double>(hdr_add(h, other.h));
  }

  double Subtract(const Histogram& other) {
    int64_t dropped = 0;
    int32_t len = std::min(h->counts_len, other.h->counts_len);
    for (int32_t i = 0; i < len; i++) {
      int64_t count = h->counts[i] - other.h->counts[i];
      if (count < 0) {
        dropped += -count;
        count = 0;
      }
      h->counts[i] = count;
    }
    hdr_reset_internal_counters(h);
    exceeds = (exceeds > other.exceeds) ? exceeds - other.exceeds : 0;
    return static_cast<double>(dropped);
  }

  size_t Count() const { return static_cast<size_t>(h->total_count); }
  size_t Exceeds() const { return exceeds; }
  int64_t Min() const { return hdr_min(h); }
  int64_t Max() const { return hdr_max(h); }
  double Mean() const { return hdr_mean(h); }
  double Stddev() const { return hdr_stddev(h); }
  double EwmaMean() const { return ewma_initialized ? ewma_mean : 0; }
  double EwmaStddev() const {
    return ewma_initialized ? std::sqrt(ewma_variance) : 0;
  }
  double EwmaErrorRate() const {
    return ewma_initialized ? ewma_error_rate : 0;
  }
  int64_t Percentile(double percentile) const {
    return hdr_value_at_percentile(h, percentile);
  }
  int64_t CountAt(int64_t value) const { return hdr_count_at_value(h, value); }

  double Cdf(int64_t value) const {
    int64_t total = h->total_count;
    if (total == 0) return 0.0;

    hdr_iter iter;
    hdr_iter_init(&iter, h);
    while (hdr_iter_next(&iter)) {
      if (iter.highest_equivalent_value >= value) {
        return static_cast<double>(iter.cumulative_count) /
               static_cast<double>(total);
      }
      if (iter.cumulative_count >= total) break;
    }
    return 1.0;
  }

  double Skewness() const {
    int64_t total = h->total_count;
    if (total < 3) return 0.0;

    double mean = hdr_mean(h);

    double m2 = 0.0;
    double m3 = 0.0;
    hdr_iter iter;
    hdr_iter_recorded_init(&iter, h);
    while (hdr_iter_next(&iter)) {
      double dev =
          static_cast<double>(hdr_median_equivalent_value(h, iter.value)) - mean;
      double d2 = dev * dev;
      m2 += static_cast<double>(iter.count) * d2;
      m3 += static_cast<double>(iter.count) * d2 * dev;
    }

    double n = static_cast<double>(total);
    double variance = m2 / n;
    if (variance == 0.0) return 0.0;
    double s3 = variance * std::sqrt(variance);
    return (m3 / n) / s3;
  }

  double Kurtosis() const {
    int64_t total = h->total_count;
    if (total < 4) return 0.0;

    double mean = hdr_mean(h);

    double m2 = 0.0;
    double m4 = 0.0;
    hdr_iter iter;
    hdr_iter_recorded_init(&iter, h);
    while (hdr_iter_next(&iter)) {
      double dev =
          static_cast<double>(hdr_median_equivalent_value(h, iter.value)) - mean;
      double d2 = dev * dev;
      m2 += static_cast<double>(iter.count) * d2;
      m4 += static_cast<double>(iter.count) * d2 * d2;
    }

    double n = static_cast<double>(total);
    double variance = m2 / n;
    if (variance == 0.0) return 0.0;
    double s4 = variance * variance;
    return (m4 / n) / s4 - 3.0;
  }

  double KsTest(const Histogram& other) const {
    int64_t n1 = h->total_count;
    int64_t n2 = other.h->total_count;
    if (n1 == 0 || n2 == 0) return 0.0;

    double max_d = 0.0;
    int64_t cum1 = 0, cum2 = 0;
    int32_t len = std::max(h->counts_len, other.h->counts_len);

    for (int32_t i = 0; i < len; i++) {
      if (i < h->counts_len) cum1 += h->counts[i];
      if (i < other.h->counts_len) cum2 += other.h->counts[i];
      double cdf1 = static_cast<double>(cum1) / static_cast<double>(n1);
      double cdf2 = static_cast<double>(cum2) / static_cast<double>(n2);
      double d = cdf1 > cdf2 ? cdf1 - cdf2 : cdf2 - cdf1;
      if (d > max_d) max_d = d;
    }
    return max_d;
  }

  void PercentilesAt(const double* percentiles,
                     int64_t* values,
                     size_t length) const {
    hdr_value_at_percentiles(h, percentiles, values, length);
  }

  MeanCIResult MeanCI(double confidence) const {
    int64_t count = h->total_count;
    double mean = hdr_mean(h);
    if (count < 2) {
      double nan = std::numeric_limits<double>::quiet_NaN();
      return {mean, nan, nan};
    }

    double stddev = hdr_stddev(h);
    if (stddev == 0.0) return {mean, mean, mean};

    double variance = stddev * stddev * static_cast<double>(count) /
                      static_cast<double>(count - 1);
    double standard_error = std::sqrt(variance / static_cast<double>(count));
    double alpha = 1.0 - confidence;
    double t_crit =
        StudentTUpperQuantile(alpha / 2.0, static_cast<double>(count - 1));
    double margin = t_crit * standard_error;
    return {mean, mean - margin, mean + margin};
  }

  WelchTestResult WelchTest(const Histogram& other, double confidence) const {
    int64_t n1 = h->total_count;
    int64_t n2 = other.h->total_count;
    if (n1 < 2 || n2 < 2) return {0, 0, 1, 0, 0};

    double mean1 = hdr_mean(h);
    double mean2 = hdr_mean(other.h);
    double sd1 = hdr_stddev(h);
    double sd2 = hdr_stddev(other.h);

    double var1 =
        sd1 * sd1 * static_cast<double>(n1) / static_cast<double>(n1 - 1);
    double var2 =
        sd2 * sd2 * static_cast<double>(n2) / static_cast<double>(n2 - 1);

    double se1 = var1 / static_cast<double>(n1);
    double se2 = var2 / static_cast<double>(n2);
    double se_sum = se1 + se2;
    if (se_sum == 0.0) return {0, 0, 1, 0, 0};

    double t = (mean1 - mean2) / std::sqrt(se_sum);

    double df = (se_sum * se_sum) / (se1 * se1 / static_cast<double>(n1 - 1) +
                                     se2 * se2 / static_cast<double>(n2 - 1));

    double p = 2.0 * StudentTCdf(-std::fabs(t), df);

    double alpha = 1.0 - confidence;
    double t_crit = StudentTUpperQuantile(alpha / 2.0, df);
    double margin = t_crit * std::sqrt(se_sum);
    double diff = mean1 - mean2;

    return {t, df, p, diff - margin, diff + margin};
  }

  MannWhitneyResult MannWhitneyTest(const Histogram& other) const {
    int64_t n1 = h->total_count;
    int64_t n2 = other.h->total_count;
    if (n1 == 0 || n2 == 0) return {0, 0, 1};

    int32_t len = std::max(h->counts_len, other.h->counts_len);

    int64_t cum2 = 0;
    double concordant = 0.0;
    double tied = 0.0;
    for (int32_t i = 0; i < len; i++) {
      int64_t c1 = (i < h->counts_len) ? h->counts[i] : 0;
      int64_t c2 = (i < other.h->counts_len) ? other.h->counts[i] : 0;
      concordant += static_cast<double>(c1) * static_cast<double>(cum2);
      tied += static_cast<double>(c1) * static_cast<double>(c2);
      cum2 += c2;
    }

    double u = concordant + 0.5 * tied;
    double dn1 = static_cast<double>(n1);
    double dn2 = static_cast<double>(n2);
    double mu = dn1 * dn2 / 2.0;

    double n_total = dn1 + dn2;
    double tie_correction = 0.0;
    for (int32_t i = 0; i < len; i++) {
      int64_t c1 = (i < h->counts_len) ? h->counts[i] : 0;
      int64_t c2 = (i < other.h->counts_len) ? other.h->counts[i] : 0;
      double tk = static_cast<double>(c1 + c2);
      if (tk > 1) {
        tie_correction += tk * tk * tk - tk;
      }
    }

    double sigma_sq =
        (dn1 * dn2 / 12.0) *
        (n_total + 1.0 - tie_correction / (n_total * (n_total - 1.0)));
    if (sigma_sq <= 0.0) return {u, 0, 1};

    double z = (u - mu) / std::sqrt(sigma_sq);
    double p = 2.0 * NormalCdf(-std::fabs(z));

    return {u, z, p};
  }

  double CohensD(const Histogram& other) const {
    int64_t n1 = h->total_count;
    int64_t n2 = other.h->total_count;
    if (n1 < 2 || n2 < 2) return 0.0;

    double mean1 = hdr_mean(h);
    double mean2 = hdr_mean(other.h);
    double sd1 = hdr_stddev(h);
    double sd2 = hdr_stddev(other.h);

    double var1 =
        sd1 * sd1 * static_cast<double>(n1) / static_cast<double>(n1 - 1);
    double var2 =
        sd2 * sd2 * static_cast<double>(n2) / static_cast<double>(n2 - 1);

    double pooled_sd = std::sqrt((static_cast<double>(n1 - 1) * var1 +
                                  static_cast<double>(n2 - 1) * var2) /
                                 static_cast<double>(n1 + n2 - 2));
    if (pooled_sd == 0.0) return 0.0;

    return (mean1 - mean2) / pooled_sd;
  }

  double CliffsD(const Histogram& other) const {
    int64_t n1 = h->total_count;
    int64_t n2 = other.h->total_count;
    if (n1 == 0 || n2 == 0) return 0.0;

    int32_t len = std::max(h->counts_len, other.h->counts_len);

    int64_t cum2 = 0;
    double concordant = 0.0;
    double tied = 0.0;
    for (int32_t i = 0; i < len; i++) {
      int64_t c1 = (i < h->counts_len) ? h->counts[i] : 0;
      int64_t c2 = (i < other.h->counts_len) ? other.h->counts[i] : 0;
      concordant += static_cast<double>(c1) * static_cast<double>(cum2);
      tied += static_cast<double>(c1) * static_cast<double>(c2);
      cum2 += c2;
    }

    double discordant =
        static_cast<double>(n1) * static_cast<double>(n2) - concordant - tied;

    return (concordant - discordant) /
           (static_cast<double>(n1) * static_cast<double>(n2));
  }

  PercentileCIResult PercentileCI(double percentile, double confidence) const {
    int64_t value = hdr_value_at_percentile(h, percentile);
    int64_t n = h->total_count;

    if (n < 2) {
      return {value, value, value};
    }

    double p = percentile / 100.0;
    double alpha = 1.0 - confidence;

    // 下界秩：最大的 j 使 BinomialCdf(j-1, n, p) <= alpha/2。
    int64_t lo = 0;
    int64_t hi = n;
    while (lo < hi) {
      int64_t mid = lo + (hi - lo + 1) / 2;
      if (BinomialCdf(mid - 1, n, p) <= alpha / 2.0) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    double lower_pct = static_cast<double>(lo) / static_cast<double>(n) * 100.0;

    // 上界秩：最小的 k 使 BinomialCdf(k-1, n, p) >= 1 - alpha/2。
    lo = 0;
    hi = n;
    while (lo < hi) {
      int64_t mid = lo + (hi - lo) / 2;
      if (BinomialCdf(mid - 1, n, p) >= 1.0 - alpha / 2.0) {
        hi = mid;
      } else {
        lo = mid + 1;
      }
    }
    double upper_pct = static_cast<double>(lo) / static_cast<double>(n) * 100.0;

    int64_t lower_val = hdr_value_at_percentile(h, lower_pct);
    int64_t upper_val = hdr_value_at_percentile(h, upper_pct);

    return {value, lower_val, upper_val};
  }

  // 序列化成 CBOR（RFC 8949）字节序列。逐行移置 Node 的实现。
  std::vector<uint8_t> Export() const {
    int32_t non_zero = 0;
    for (int32_t i = 0; i < h->counts_len; i++) {
      if (h->counts[i] != 0) non_zero++;
    }

    bool has_ewma = ewma_alpha > 0;
    uint64_t map_size = has_ewma ? 12 : 11;

    std::vector<uint8_t> out;
    out.reserve(64 + static_cast<size_t>(non_zero) * 10);

    CborWriteUint(out, kCborMap, map_size);

    CborWriteUint(out, kCborUint, kKeyVersion);
    CborWriteUint(out, kCborUint, kExportVersion);
    CborWriteUint(out, kCborUint, kKeyLowest);
    CborWriteUint(out, kCborUint,
                  static_cast<uint64_t>(h->lowest_discernible_value));
    CborWriteUint(out, kCborUint, kKeyHighest);
    CborWriteUint(out, kCborUint,
                  static_cast<uint64_t>(h->highest_trackable_value));
    CborWriteUint(out, kCborUint, kKeyFigures);
    CborWriteUint(out, kCborUint,
                  static_cast<uint64_t>(h->significant_figures));
    CborWriteUint(out, kCborUint, kKeyTotalCount);
    CborWriteUint(out, kCborUint, static_cast<uint64_t>(h->total_count));
    CborWriteUint(out, kCborUint, kKeyMin);
    CborWriteUint(out, kCborUint, static_cast<uint64_t>(h->min_value));
    CborWriteUint(out, kCborUint, kKeyMax);
    CborWriteUint(out, kCborUint, static_cast<uint64_t>(h->max_value));
    CborWriteUint(out, kCborUint, kKeyNormOffset);
    CborWriteUint(out, kCborUint,
                  static_cast<uint64_t>(h->normalizing_index_offset));
    CborWriteUint(out, kCborUint, kKeyConvRatio);
    CborWriteFloat64(out, h->conversion_ratio);
    CborWriteUint(out, kCborUint, kKeyCountsLen);
    CborWriteUint(out, kCborUint, static_cast<uint64_t>(h->counts_len));
    // 稀疏计数：扁平的 [delta, count, ...] 对，索引做 delta 编码。
    CborWriteUint(out, kCborUint, kKeyCounts);
    CborWriteUint(out, kCborArray, static_cast<uint64_t>(non_zero) * 2);
    int32_t prev_idx = 0;
    for (int32_t i = 0; i < h->counts_len; i++) {
      if (h->counts[i] != 0) {
        CborWriteUint(out, kCborUint, static_cast<uint64_t>(i - prev_idx));
        CborWriteUint(out, kCborUint, static_cast<uint64_t>(h->counts[i]));
        prev_idx = i;
      }
    }

    if (has_ewma) {
      CborWriteUint(out, kCborUint, kKeyEwma);
      CborWriteUint(out, kCborMap, 5);
      CborWriteUint(out, kCborUint, 0);
      CborWriteFloat64(out, ewma_alpha);
      CborWriteUint(out, kCborUint, 1);
      CborWriteFloat64(out, ewma_mean);
      CborWriteUint(out, kCborUint, 2);
      CborWriteFloat64(out, ewma_variance);
      CborWriteUint(out, kCborUint, 3);
      CborWriteFloat64(out, ewma_error_rate);
      CborWriteUint(out, kCborUint, 4);
      CborWriteUint(out, kCborUint, static_cast<uint64_t>(threshold));
    }

    return out;
  }

  static Histogram* Import(const uint8_t* data, size_t len) {
    const uint8_t* p = data;
    const uint8_t* end = data + len;

    if (p >= end || (*p >> 5) != 5) return nullptr;  // 必须是 map。
    uint64_t map_size;
    if (!CborReadUint(p, end, &map_size)) return nullptr;

    int64_t lowest = 1;
    int64_t highest = std::numeric_limits<int64_t>::max();
    int figures = 3;
    int64_t total_count = 0;
    int64_t min_value = std::numeric_limits<int64_t>::max();
    int64_t max_value = 0;
    int32_t norm_offset = 0;
    double conv_ratio = 1.0;
    int32_t counts_len = 0;
    uint64_t version = 0;

    std::vector<std::pair<int32_t, int64_t>> sparse_counts;

    double ewma_alpha = 0;
    double ewma_mean = 0;
    double ewma_variance = 0;
    double ewma_error_rate = 0;
    int64_t threshold = 0;

    for (uint64_t i = 0; i < map_size; i++) {
      uint64_t key;
      if (!CborReadUint(p, end, &key)) return nullptr;

      switch (key) {
        case kKeyVersion:
          if (!CborReadUint(p, end, &version)) return nullptr;
          if (version != kExportVersion) return nullptr;
          break;
        case kKeyLowest: {
          uint64_t v;
          if (!CborReadUint(p, end, &v)) return nullptr;
          lowest = static_cast<int64_t>(v);
          break;
        }
        case kKeyHighest: {
          uint64_t v;
          if (!CborReadUint(p, end, &v)) return nullptr;
          highest = static_cast<int64_t>(v);
          break;
        }
        case kKeyFigures: {
          uint64_t v;
          if (!CborReadUint(p, end, &v)) return nullptr;
          figures = static_cast<int>(v);
          break;
        }
        case kKeyTotalCount: {
          uint64_t v;
          if (!CborReadUint(p, end, &v)) return nullptr;
          total_count = static_cast<int64_t>(v);
          break;
        }
        case kKeyMin: {
          uint64_t v;
          if (!CborReadUint(p, end, &v)) return nullptr;
          min_value = static_cast<int64_t>(v);
          break;
        }
        case kKeyMax: {
          uint64_t v;
          if (!CborReadUint(p, end, &v)) return nullptr;
          max_value = static_cast<int64_t>(v);
          break;
        }
        case kKeyNormOffset: {
          uint64_t v;
          if (!CborReadUint(p, end, &v)) return nullptr;
          norm_offset = static_cast<int32_t>(v);
          break;
        }
        case kKeyConvRatio:
          if (!CborReadNumber(p, end, &conv_ratio)) return nullptr;
          break;
        case kKeyCountsLen: {
          uint64_t v;
          if (!CborReadUint(p, end, &v)) return nullptr;
          counts_len = static_cast<int32_t>(v);
          break;
        }
        case kKeyCounts: {
          if (p >= end || (*p >> 5) != 4) return nullptr;
          uint64_t arr_len;
          if (!CborReadUint(p, end, &arr_len)) return nullptr;
          if (arr_len % 2 != 0) return nullptr;
          // 每个元素至少 1 字节，因此 arr_len 不可能超过剩余缓冲。
          if (arr_len > static_cast<uint64_t>(end - p)) return nullptr;
          sparse_counts.reserve(static_cast<size_t>(arr_len / 2));
          int32_t acc_idx = 0;
          for (uint64_t j = 0; j < arr_len; j += 2) {
            uint64_t delta, cnt;
            if (!CborReadUint(p, end, &delta)) return nullptr;
            if (!CborReadUint(p, end, &cnt)) return nullptr;
            acc_idx += static_cast<int32_t>(delta);
            sparse_counts.emplace_back(acc_idx, static_cast<int64_t>(cnt));
          }
          break;
        }
        case kKeyEwma: {
          if (p >= end || (*p >> 5) != 5) return nullptr;
          uint64_t sub_size;
          if (!CborReadUint(p, end, &sub_size)) return nullptr;
          for (uint64_t j = 0; j < sub_size; j++) {
            uint64_t sub_key;
            if (!CborReadUint(p, end, &sub_key)) return nullptr;
            switch (sub_key) {
              case 0:
                if (!CborReadNumber(p, end, &ewma_alpha)) return nullptr;
                break;
              case 1:
                if (!CborReadNumber(p, end, &ewma_mean)) return nullptr;
                break;
              case 2:
                if (!CborReadNumber(p, end, &ewma_variance)) return nullptr;
                break;
              case 3:
                if (!CborReadNumber(p, end, &ewma_error_rate)) return nullptr;
                break;
              case 4: {
                uint64_t v;
                if (!CborReadUint(p, end, &v)) return nullptr;
                threshold = static_cast<int64_t>(v);
                break;
              }
              default:
                return nullptr;  // 未知 EWMA 键。
            }
          }
          break;
        }
        default:
          return nullptr;  // 未知键。
      }
    }

    Options opts;
    opts.lowest = lowest;
    opts.highest = highest;
    opts.figures = figures;
    // alpha = 1 - 2^(-1/halfLife) => halfLife = -1 / log2(1 - alpha)
    if (ewma_alpha > 0 && ewma_alpha < 1) {
      opts.half_life = -1.0 / std::log2(1.0 - ewma_alpha);
    }
    opts.threshold = threshold;

    Histogram* histogram = Histogram::Create(opts);
    if (histogram == nullptr) return nullptr;

    if (histogram->h->counts_len != counts_len) {
      delete histogram;
      return nullptr;
    }

    for (const auto& [idx, cnt] : sparse_counts) {
      if (idx < 0 || idx >= counts_len) {
        delete histogram;
        return nullptr;
      }
      histogram->h->counts[idx] = cnt;
    }
    histogram->h->total_count = total_count;
    histogram->h->min_value = min_value;
    histogram->h->max_value = max_value;
    histogram->h->normalizing_index_offset = norm_offset;
    histogram->h->conversion_ratio = conv_ratio;

    if (ewma_alpha > 0) {
      histogram->ewma_mean = ewma_mean;
      histogram->ewma_variance = ewma_variance;
      histogram->ewma_error_rate = ewma_error_rate;
      histogram->ewma_initialized = true;
    }

    return histogram;
  }

  template <typename Fn>
  void Percentiles(Fn&& fn) const {
    hdr_iter iter;
    hdr_iter_percentile_init(&iter, h, 1);
    while (hdr_iter_next(&iter)) {
      double key = iter.specifics.percentiles.percentile;
      fn(key, iter.value);
    }
  }

  template <typename Fn>
  void LinearBuckets(int64_t step_size, Fn&& fn) const {
    hdr_iter iter;
    hdr_iter_linear_init(&iter, h, step_size);
    while (hdr_iter_next(&iter)) {
      fn(iter.value, iter.specifics.linear.count_added_in_this_iteration_step);
    }
  }

  template <typename Fn>
  void LogBuckets(int64_t first_bucket, double log_base, Fn&& fn) const {
    hdr_iter iter;
    hdr_iter_log_init(&iter, h, first_bucket, log_base);
    while (hdr_iter_next(&iter)) {
      fn(iter.value, iter.specifics.log.count_added_in_this_iteration_step);
    }
  }
};

// ---------------------------------------------------------------------------
// scratch 缓冲区：变长/定长结果通过它们交给 JS 读（JS 不往 wasm 里写指针）
// ---------------------------------------------------------------------------

std::vector<double> g_keys;
std::vector<int64_t> g_vals;
std::vector<uint8_t> g_bytes;
double g_out[8] = {0};
int64_t g_iout[8] = {0};

inline Histogram* H(int32_t handle) {
  return reinterpret_cast<Histogram*>(static_cast<uintptr_t>(static_cast<uint32_t>(handle)));
}
inline int32_t Handle(Histogram* h) {
  return static_cast<int32_t>(reinterpret_cast<uintptr_t>(h));
}

}  // namespace

// ---------------------------------------------------------------------------
// 导出的 C ABI
// ---------------------------------------------------------------------------

WN_EXPORT(wn_histo_new)(int64_t lowest, int64_t highest, int32_t figures,
                        double half_life, int64_t threshold) {
  Options opts;
  opts.lowest = lowest;
  opts.highest = highest;
  opts.figures = figures;
  opts.half_life = half_life;
  opts.threshold = threshold;
  return Handle(Histogram::Create(opts));
}

WN_EXPORT(wn_histo_free)(int32_t handle) { delete H(handle); }

WN_EXPORT(wn_histo_reset)(int32_t handle) { H(handle)->Reset(); }

WN_EXPORT(wn_histo_record)(int32_t handle, int64_t value) {
  return H(handle)->Record(value) ? 1 : 0;
}

WN_EXPORT(wn_histo_record_corrected)(int32_t handle, int64_t value,
                                     int64_t expected_interval) {
  return H(handle)->RecordCorrected(value, expected_interval) ? 1 : 0;
}

WN_EXPORT(wn_histo_record_delta)(int32_t handle, uint64_t now) {
  return static_cast<double>(H(handle)->RecordDelta(now));
}

WN_EXPORT(wn_histo_add)(int32_t dst, int32_t src) {
  return H(dst)->Add(*H(src));
}

WN_EXPORT(wn_histo_subtract)(int32_t dst, int32_t src) {
  return H(dst)->Subtract(*H(src));
}

WN_EXPORT(wn_histo_count)(int32_t handle) {
  return static_cast<int64_t>(H(handle)->Count());
}

WN_EXPORT(wn_histo_exceeds)(int32_t handle) {
  return static_cast<int64_t>(H(handle)->Exceeds());
}

WN_EXPORT(wn_histo_min)(int32_t handle) { return H(handle)->Min(); }
WN_EXPORT(wn_histo_max)(int32_t handle) { return H(handle)->Max(); }
WN_EXPORT(wn_histo_mean)(int32_t handle) { return H(handle)->Mean(); }
WN_EXPORT(wn_histo_stddev)(int32_t handle) { return H(handle)->Stddev(); }
WN_EXPORT(wn_histo_skewness)(int32_t handle) { return H(handle)->Skewness(); }
WN_EXPORT(wn_histo_kurtosis)(int32_t handle) { return H(handle)->Kurtosis(); }
WN_EXPORT(wn_histo_ewma_mean)(int32_t handle) { return H(handle)->EwmaMean(); }
WN_EXPORT(wn_histo_ewma_stddev)(int32_t handle) {
  return H(handle)->EwmaStddev();
}
WN_EXPORT(wn_histo_ewma_error_rate)(int32_t handle) {
  return H(handle)->EwmaErrorRate();
}

WN_EXPORT(wn_histo_percentile)(int32_t handle, double percentile) {
  return H(handle)->Percentile(percentile);
}

WN_EXPORT(wn_histo_count_at)(int32_t handle, int64_t value) {
  return H(handle)->CountAt(value);
}

WN_EXPORT(wn_histo_cdf)(int32_t handle, int64_t value) {
  return H(handle)->Cdf(value);
}

WN_EXPORT(wn_histo_ks_test)(int32_t a, int32_t b) {
  return H(a)->KsTest(*H(b));
}

WN_EXPORT(wn_histo_cohens_d)(int32_t a, int32_t b) {
  return H(a)->CohensD(*H(b));
}

WN_EXPORT(wn_histo_cliffs_d)(int32_t a, int32_t b) {
  return H(a)->CliffsD(*H(b));
}

WN_EXPORT(wn_histo_mean_ci)(int32_t handle, double confidence) {
  auto r = H(handle)->MeanCI(confidence);
  g_out[0] = r.mean;
  g_out[1] = r.lower;
  g_out[2] = r.upper;
}

WN_EXPORT(wn_histo_welch_test)(int32_t a, int32_t b, double confidence) {
  auto r = H(a)->WelchTest(*H(b), confidence);
  g_out[0] = r.t_statistic;
  g_out[1] = r.degrees_of_freedom;
  g_out[2] = r.p_value;
  g_out[3] = r.ci_lower;
  g_out[4] = r.ci_upper;
}

WN_EXPORT(wn_histo_mann_whitney)(int32_t a, int32_t b) {
  auto r = H(a)->MannWhitneyTest(*H(b));
  g_out[0] = r.u_statistic;
  g_out[1] = r.z_score;
  g_out[2] = r.p_value;
}

WN_EXPORT(wn_histo_percentile_ci)(int32_t handle, double percentile,
                                  double confidence) {
  auto r = H(handle)->PercentileCI(percentile, confidence);
  g_iout[0] = r.value;
  g_iout[1] = r.lower;
  g_iout[2] = r.upper;
}

WN_EXPORT(wn_histo_percentiles)(int32_t handle) {
  g_keys.clear();
  g_vals.clear();
  H(handle)->Percentiles([&](double key, int64_t value) {
    g_keys.push_back(key);
    g_vals.push_back(value);
  });
  return static_cast<int32_t>(g_vals.size());
}

WN_EXPORT(wn_histo_percentiles_at)(int32_t handle, int32_t input_ptr,
                                   int32_t count) {
  const double* input = reinterpret_cast<const double*>(
      static_cast<uintptr_t>(static_cast<uint32_t>(input_ptr)));
  g_vals.assign(static_cast<size_t>(count), 0);
  H(handle)->PercentilesAt(input, g_vals.data(), static_cast<size_t>(count));
  g_keys.clear();
  for (int32_t i = 0; i < count; i++) g_keys.push_back(input[i]);
  return count;
}

WN_EXPORT(wn_histo_linear_buckets)(int32_t handle, int64_t step_size) {
  g_keys.clear();
  g_vals.clear();
  H(handle)->LinearBuckets(step_size, [&](int64_t value, int64_t count) {
    g_keys.push_back(static_cast<double>(value));
    g_vals.push_back(count);
  });
  return static_cast<int32_t>(g_vals.size());
}

WN_EXPORT(wn_histo_log_buckets)(int32_t handle, int64_t first_bucket,
                                double log_base) {
  g_keys.clear();
  g_vals.clear();
  H(handle)->LogBuckets(first_bucket, log_base,
                        [&](int64_t value, int64_t count) {
                          g_keys.push_back(static_cast<double>(value));
                          g_vals.push_back(count);
                        });
  return static_cast<int32_t>(g_vals.size());
}

WN_EXPORT(wn_histo_keys_ptr)() {
  return static_cast<int32_t>(
      reinterpret_cast<uintptr_t>(g_keys.data()));
}

WN_EXPORT(wn_histo_vals_ptr)() {
  return static_cast<int32_t>(
      reinterpret_cast<uintptr_t>(g_vals.data()));
}

WN_EXPORT(wn_histo_out_ptr)() {
  return static_cast<int32_t>(reinterpret_cast<uintptr_t>(g_out));
}

WN_EXPORT(wn_histo_iout_ptr)() {
  return static_cast<int32_t>(reinterpret_cast<uintptr_t>(g_iout));
}

WN_EXPORT(wn_histo_export)(int32_t handle) {
  g_bytes = H(handle)->Export();
  return static_cast<int32_t>(g_bytes.size());
}

WN_EXPORT(wn_histo_bytes_ptr)() {
  return static_cast<int32_t>(
      reinterpret_cast<uintptr_t>(g_bytes.data()));
}

// 导入：先把 CBOR 字节拷进模块内的 g_bytes，再解析成新句柄。
WN_EXPORT(wn_histo_import_begin)(int32_t len) {
  g_bytes.assign(static_cast<size_t>(len), 0);
  return static_cast<int32_t>(
      reinterpret_cast<uintptr_t>(g_bytes.data()));
}

WN_EXPORT(wn_histo_import_commit)() {
  Histogram* histogram = Histogram::Import(g_bytes.data(), g_bytes.size());
  return Handle(histogram);
}

// wasi-libc 的 malloc/free 通过薄包装导出，供 JS 分配临时缓冲。
extern "C" void* malloc(size_t);
extern "C" void free(void*);

WN_EXPORT(wn_alloc)(int32_t size) { return static_cast<int32_t>(
    reinterpret_cast<uintptr_t>(malloc(static_cast<size_t>(size)))); }

WN_EXPORT(wn_dealloc)(int32_t ptr) {
  free(reinterpret_cast<void*>(
      static_cast<uintptr_t>(static_cast<uint32_t>(ptr))));
}
