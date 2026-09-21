/**
 * A corpus of `getColorDepth`/`hasColors` environments, shared by the oracle
 * generator and the parity test.
 *
 * `tools/tty-corpus-oracle.mjs` runs this through a real Node and writes
 * `test/fixtures/tty-corpus.json`; `test/tty-corpus.test.ts` runs the identical
 * list through the web-node runtime and asserts the answers are equal. Keeping
 * one list means neither side can drift.
 *
 * Every case passes an explicit env object, so the answer depends only on the
 * table in `lib/internal/tty.js` — never on the machine's real environment.
 * `process.platform` is `darwin` for the oracle and `linux` for the runtime;
 * both are non-win32, so they take the same branch and the comparison is valid.
 */
export function colorDepthCases() {
  return [
    // FORCE_COLOR wins over everything else.
    ['forceColorEmpty', { FORCE_COLOR: '' }],
    ['forceColor1', { FORCE_COLOR: '1' }],
    ['forceColorTrue', { FORCE_COLOR: 'true' }],
    ['forceColor2', { FORCE_COLOR: '2' }],
    ['forceColor3', { FORCE_COLOR: '3' }],
    ['forceColorZero', { FORCE_COLOR: '0' }],
    ['forceColorJunk', { FORCE_COLOR: 'yes' }],
    ['forceColorOverridesNoColor', { FORCE_COLOR: '3', NO_COLOR: '1' }],
    ['forceColorOverridesDisable', { FORCE_COLOR: '2', NODE_DISABLE_COLORS: '1' }],

    // The opt-outs.
    ['noColor', { NO_COLOR: '1' }],
    ['noColorEmptyIsIgnored', { NO_COLOR: '' }],
    ['disableColors', { NODE_DISABLE_COLORS: '1' }],
    ['disableColorsEmptyIgnored', { NODE_DISABLE_COLORS: '' }],
    ['termDumb', { TERM: 'dumb' }],
    ['noColorBeatsTerm', { NO_COLOR: '1', TERM: 'xterm-256color' }],

    // tmux and the CI tables.
    ['tmux', { TMUX: '/tmp/tmux-501/default,123,0' }],
    ['azurePipelines', { TF_BUILD: 'True', AGENT_NAME: 'Hosted Agent' }],
    ['azurePipelinesNeedsAgentName', { TF_BUILD: 'True' }],
    ['ciBare', { CI: 'true' }],
    ['ciGithubActions', { CI: 'true', GITHUB_ACTIONS: 'true' }],
    ['ciGitlab', { CI: 'true', GITLAB_CI: 'true' }],
    ['ciCircleCi', { CI: 'true', CIRCLECI: 'true' }],
    ['ciTravis', { CI: 'true', TRAVIS: 'true' }],
    ['ciDrone', { CI: 'true', DRONE: 'true' }],
    ['ciBuildkite', { CI: 'true', BUILDKITE: 'true' }],
    ['ciCodeship', { CI: 'true', CI_NAME: 'codeship' }],
    ['ciUnknown', { CI: 'true', SOMETHING: '1' }],
    ['ciNameAloneIsIgnored', { CI_NAME: 'codeship' }],

    // TeamCity matches a version prefix, not mere presence.
    ['teamcityOld', { TEAMCITY_VERSION: '9.0.1' }],
    ['teamcity10', { TEAMCITY_VERSION: '10.0.0' }],
    ['teamcitySingleDigit', { TEAMCITY_VERSION: '9.1.2' }],
    ['teamcityAbsentLike', { TEAMCITY_VERSION: '8.1.2' }],

    // TERM_PROGRAM.
    ['iTermNoVersion', { TERM_PROGRAM: 'iTerm.app' }],
    ['iTerm2', { TERM_PROGRAM: 'iTerm.app', TERM_PROGRAM_VERSION: '2.9' }],
    ['iTerm3', { TERM_PROGRAM: 'iTerm.app', TERM_PROGRAM_VERSION: '3.4.1' }],
    ['hyper', { TERM_PROGRAM: 'HyperTerm' }],
    ['macTerm', { TERM_PROGRAM: 'MacTerm' }],
    ['appleTerminal', { TERM_PROGRAM: 'Apple_Terminal' }],
    ['unknownTermProgram', { TERM_PROGRAM: 'WezTerm' }],

    // COLORTERM, before and after TERM.
    ['colortermTruecolor', { COLORTERM: 'truecolor' }],
    ['colorterm24bit', { COLORTERM: '24bit' }],
    ['colortermOther', { COLORTERM: 'yes' }],
    ['termBeatsColorterm', { TERM: 'xterm', COLORTERM: 'yes' }],

    // TERM lookups, table and regex.
    ['termXterm256', { TERM: 'xterm-256color' }],
    ['termTruecolorSubstring', { TERM: 'xterm-truecolor' }],
    ['termXtermKitty', { TERM: 'xterm-kitty' }],
    ['termRxvtUnicode24Bit', { TERM: 'rxvt-unicode-24bit' }],
    ['termScreen', { TERM: 'screen' }],
    ['termScreen256', { TERM: 'screen-256color' }],
    ['termLinux', { TERM: 'linux' }],
    ['termCons25', { TERM: 'cons25' }],
    ['termMosh', { TERM: 'mosh' }],
    ['termTerminator', { TERM: 'terminator' }],
    ['termAnsiUpper', { TERM: 'ANSI' }],
    ['termVt100', { TERM: 'vt100' }],
    ['termUnknown', { TERM: 'weird-term' }],

    // The empty environment.
    ['empty', {}],
  ];
}

export function hasColorsCases() {
  return [
    // `hasColors(count, env)`.
    ['twoOnSixteen', [2, { FORCE_COLOR: '1' }]],
    ['sixteenOnSixteen', [16, { FORCE_COLOR: '1' }]],
    ['sixteenOnTwo', [16, { FORCE_COLOR: '0' }]],
    ['twoOnTwo', [2, { FORCE_COLOR: '0' }]],
    ['twoFiftySixOn256', [256, { FORCE_COLOR: '2' }]],
    ['twoFiftySixOn16', [256, { FORCE_COLOR: '1' }]],
    ['sixteenMillionOnTruecolor', [16777216, { FORCE_COLOR: '3' }]],
    ['sixteenMillionOn16m', [16777216, { FORCE_COLOR: '2' }]],
    ['defaultCountUsesSixteen', [{ FORCE_COLOR: '1' }]],
    ['defaultCountTruecolor', [{ FORCE_COLOR: '3' }]],
  ];
}
