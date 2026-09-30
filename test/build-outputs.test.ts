import { describe, expect, it } from 'vitest';
import { selectBuildOutputs } from '../src/ui/build-outputs';

describe('selectBuildOutputs', () => {
  it('takes everything under the output dir plus any brand-new file', () => {
    const before = ['/project/webpack/index.js', '/project/webpack/node_modules/x/index.js'];
    const buildTree = [
      { path: '/project/webpack/index.js', type: 'file' as const },
      { path: '/project/webpack/node_modules/x/index.js', type: 'file' as const },
      { path: '/project/webpack/dist', type: 'dir' as const },
      { path: '/project/webpack/dist/bundle.js', type: 'file' as const },
      { path: '/project/webpack/dist/assets/logo.svg', type: 'file' as const },
      { path: '/project/webpack/stats.json', type: 'file' as const },
    ];
    expect(selectBuildOutputs(buildTree, before, '/project/webpack/dist')).toEqual([
      '/project/webpack/dist/bundle.js',
      '/project/webpack/dist/assets/logo.svg',
      '/project/webpack/stats.json',
    ]);
  });

  it('leaves pre-existing files outside the output dir alone', () => {
    const buildTree = [{ path: '/project/webpack/index.js', type: 'file' as const }];
    expect(selectBuildOutputs(buildTree, ['/project/webpack/index.js'], '/project/webpack/dist')).toEqual([]);
  });

  it('tolerates a trailing slash on the output dir', () => {
    const buildTree = [{ path: '/project/vite/dist/index.html', type: 'file' as const }];
    expect(selectBuildOutputs(buildTree, [], '/project/vite/dist/')).toEqual(['/project/vite/dist/index.html']);
  });
});
