import { describe, it, expect, vi } from 'vitest';

// Leaflet が global にないと history.js 読込で参照エラーになるので軽くスタブ
globalThis.L = {
  latLngBounds: (corners) => ({ _corners: corners, isValid: () => true }),
};

import { ringArea, pickMainlandRing, ringExtent } from '../public/assets/history.js';

describe('ringArea', () => {
  it('1x1 の正方形 ring は面積 1', () => {
    const square = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
    expect(ringArea(square)).toBeCloseTo(1, 6);
  });

  it('反時計回りでも絶対値で 1', () => {
    const ccw = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]];
    expect(ringArea(ccw)).toBeCloseTo(1, 6);
  });

  it('3x3 正方形は面積 9', () => {
    const r = [[0, 0], [3, 0], [3, 3], [0, 3], [0, 0]];
    expect(ringArea(r)).toBeCloseTo(9, 6);
  });
});

describe('ringExtent', () => {
  it('外周の最大・最小経緯度を返す', () => {
    const ring = [[140, 35], [141, 35], [141, 36], [140, 36], [140, 35]];
    expect(ringExtent(ring)).toEqual({
      minLat: 35, maxLat: 36, minLon: 140, maxLon: 141,
    });
  });

  it('空配列は null', () => {
    expect(ringExtent([])).toBeNull();
  });
});

describe('pickMainlandRing', () => {
  it('Polygon は唯一の外周 ring を返す', () => {
    const feature = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
      },
    };
    expect(pickMainlandRing(feature)).toEqual(
      [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]],
    );
  });

  it('MultiPolygon は最大面積の外周 ring を返す（離島除外）', () => {
    // 関東のミニチュア: 本土 3x3 + 小笠原相当の小さな 0.5x0.5 離島
    const mainland = [[139, 35], [142, 35], [142, 38], [139, 38], [139, 35]];
    const remote = [[142.0, 27.0], [142.5, 27.0], [142.5, 27.5], [142.0, 27.5], [142.0, 27.0]];
    const feature = {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: [[mainland], [remote]],
      },
    };
    // 本土が選ばれるべき
    const ring = pickMainlandRing(feature);
    expect(ring).toEqual(mainland);
  });

  it('順序が逆でも最大面積側が選ばれる', () => {
    const mainland = [[139, 35], [142, 35], [142, 38], [139, 38], [139, 35]];
    const remote = [[142.0, 27.0], [142.5, 27.0], [142.5, 27.5], [142.0, 27.5], [142.0, 27.0]];
    const feature = {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: [[remote], [mainland]],
      },
    };
    expect(pickMainlandRing(feature)).toEqual(mainland);
  });

  it('未対応 geometry は null', () => {
    expect(pickMainlandRing({ geometry: { type: 'Point', coordinates: [0, 0] } })).toBeNull();
    expect(pickMainlandRing(null)).toBeNull();
  });
});
