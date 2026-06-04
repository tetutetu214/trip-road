/**
 * Mapbox GL JS v3 によるメイン地図。
 * 現在地マーカー、軌跡ライン、陰影起伏図トグルを管理する。
 * mapboxgl は index.html で CDN 読込した global を使う。
 *
 * 地理院タイル + Leaflet からの移行（2026-06-03）。履歴画面（history.js）は
 * 引き続き Leaflet を使うため、両ライブラリが併存する。
 *
 * 座標順の注意: Mapbox / GeoJSON は [lng, lat]（経度・緯度の順）。
 * アプリ内部の track は {lat, lon} なので、Mapbox に渡すときは必ず
 * [lon, lat] に並べ替える。
 */
const STANDARD_STYLE = 'mapbox://styles/mapbox/standard';
// 起動時は日本列島全体が収まる引きの画から始め、GPS 確定時に現在地へ
// 一気に寄せる「ズームイン」の演出を出す。center は本州中央付近。
const INITIAL_CENTER = [137.5, 37.5]; // [lng, lat]
const INITIAL_ZOOM = 4;
const FIRST_FIX_ZOOM = 14;

let map = null;
let marker = null;
let markerAdded = false;
let styleLoaded = false;
// 軌跡の座標は常に JS 側で保持する（[lng, lat] の配列）。
// style.load 前に setTrack/addTrackPoint が来てもここに溜め、ロード後に反映する。
let trackCoords = [];
// style.load 前に来た現在地更新を保留する。
let pendingLocation = null;
// 現在の陰影レベル（'off'/'weak'/'strong'）。
let hillshadeLevel = 'off';

/**
 * 端末の現在時刻から Standard スタイルの lightPreset を決める。
 * 明け方 / 昼 / 夕暮れ / 夜の 4 段階で地図全体の照明・影が変わる。
 */
export function lightPresetForHour(hour) {
  if (hour < 5) return 'night';
  if (hour < 8) return 'dawn';
  if (hour < 17) return 'day';
  if (hour < 19) return 'dusk';
  return 'night';
}

// 陰影起伏図の強度（hillshade-exaggeration）。'off' はレイヤー非表示。
// 仕様上 0〜1 が上限。以前は weak0.4/strong0.7 で効果が薄かったため引き上げ。
const HILLSHADE_EXAGGERATION = { off: 0, weak: 0.7, strong: 1.0 };

function trackGeoJSON() {
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: trackCoords },
    properties: {},
  };
}

/**
 * Mapbox 地図を初期化する。token は Workers 経由で取得した公開トークン(pk)。
 */
export function initMap(containerId, token) {
  mapboxgl.accessToken = token;
  map = new mapboxgl.Map({
    container: containerId,
    style: STANDARD_STYLE,
    center: INITIAL_CENTER,
    zoom: INITIAL_ZOOM,
    attributionControl: true, // 規約上、出典表記は表示したまま
  });

  // 現在地マーカー（mintグリーンの二重丸 SVG）。位置確定後に addTo する。
  const el = document.createElement('div');
  el.className = 'current-location-marker';
  el.innerHTML = `<svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
    <circle cx="9" cy="9" r="7" stroke="#9fe1cb" stroke-width="1.2" fill="none"/>
    <circle cx="9" cy="9" r="2.5" fill="#9fe1cb"/>
  </svg>`;
  marker = new mapboxgl.Marker({ element: el });

  // Standard スタイルの config 適用（lightPreset）とソース/レイヤー追加は
  // スタイル読込完了後でないと反映されない。'load' ではなく 'style.load' を使う。
  map.on('style.load', () => {
    styleLoaded = true;

    // 時間連動のライトプリセット
    map.setConfigProperty('basemap', 'lightPreset', lightPresetForHour(new Date().getHours()));

    // 陰影起伏図用の DEM ソースと hillshade レイヤー（初期は非表示）。
    // 地図の地形感を出す。slot 'bottom' で道路・ラベルの下に置く。
    if (!map.getSource('mapbox-dem')) {
      map.addSource('mapbox-dem', {
        type: 'raster-dem',
        url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
        tileSize: 512,
        maxzoom: 14,
      });
    }
    if (!map.getLayer('hillshade')) {
      map.addLayer({
        id: 'hillshade',
        type: 'hillshade',
        source: 'mapbox-dem',
        slot: 'bottom',
        layout: { visibility: 'none' },
        paint: { 'hillshade-exaggeration': HILLSHADE_EXAGGERATION.weak },
      });
    }
    applyHillshade();

    // 軌跡ライン。地理院 pale 地図での視認性問題に倣い、補色のマゼンタ。
    if (!map.getSource('track')) {
      map.addSource('track', { type: 'geojson', data: trackGeoJSON() });
    }
    if (!map.getLayer('track-line')) {
      map.addLayer({
        id: 'track-line',
        type: 'line',
        source: 'track',
        slot: 'top',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        // line-emissive-strength: 1 で Standard の 3D 照明を無視し、
        // 夜の lightPreset でもマゼンタのまま発光させる（夜に黒く沈む対策）。
        paint: {
          'line-color': '#ff4d8c',
          'line-width': 3,
          'line-opacity': 0.9,
          'line-emissive-strength': 1,
        },
      });
    }

    // style.load 前に来ていた現在地更新があれば反映する。
    if (pendingLocation) {
      const { lat, lon, isFirst } = pendingLocation;
      pendingLocation = null;
      updateCurrentLocation(lat, lon, isFirst);
    }
  });

  // 最小化→復帰や画面回転・リサイズ時に地図サイズを再計算する。
  // iOS Safari でバックグラウンド復帰時に viewport が一時的にずれて、
  // .map のレイアウトが崩れて上部チップが地図に隠れる現象への対策。
  const refreshSize = () => {
    if (!map) return;
    // CSS の再計算が完了してから resize を呼ぶため少し遅延
    setTimeout(() => map.resize(), 100);
  };
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshSize();
  });
  window.addEventListener('pageshow', refreshSize);
  window.addEventListener('resize', () => {
    if (map) map.resize();
  });
  window.addEventListener('orientationchange', refreshSize);

  // 下部カードの実高を CSS 変数 --card-height に反映する。
  // 「土地のたより」本文の長さでカードが可変なので、固定 320px だと長文時に
  // 地図領域とカード不透明部が重なって地図ラベルが隠れる事象を防ぐ。
  const card = document.querySelector('.bottom-card');
  if (card && typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      const h = card.offsetHeight;
      document.documentElement.style.setProperty('--card-height', `${h}px`);
      if (map) map.resize();
    });
    ro.observe(card);
  }

  return map;
}

/**
 * 現在地を更新（追従 ON 固定）。
 */
export function updateCurrentLocation(lat, lon, isFirst = false) {
  if (!map || !marker) return;
  // スタイル未ロード時は保留し、style.load 後に適用する。
  if (!styleLoaded) {
    pendingLocation = { lat, lon, isFirst };
    return;
  }
  marker.setLngLat([lon, lat]);
  if (!markerAdded) {
    marker.addTo(map);
    markerAdded = true;
  }
  if (isFirst) {
    // 初回の位置確定: 日本全体の引きの画から現在地へ一気に寄る演出。
    // flyTo は途中で一度引いてから寄る弧を描くので「ズームしていく」感が出る。
    map.flyTo({
      center: [lon, lat],
      zoom: FIRST_FIX_ZOOM,
      duration: 3500,
      curve: 1.6,
      essential: true, // prefers-reduced-motion でも実行（追従に必要なため）
    });
  } else {
    // 2 回目以降は現在のズームを保ったまま中心だけ滑らかに追従。
    map.easeTo({ center: [lon, lat], zoom: map.getZoom(), duration: 300 });
  }
}

export function addTrackPoint(lat, lon) {
  trackCoords.push([lon, lat]);
  const source = map && map.getSource('track');
  if (source) source.setData(trackGeoJSON());
}

export function setTrack(points) {
  trackCoords = points.map(p => [p.lon, p.lat]);
  const source = map && map.getSource('track');
  if (source) source.setData(trackGeoJSON());
}

/**
 * 地図上の軌跡ラインを空にする。
 * localStorage 側の track は変更しない（履歴データは温存）。
 */
export function clearTrack() {
  trackCoords = [];
  const source = map && map.getSource('track');
  if (source) source.setData(trackGeoJSON());
}

/**
 * hillshade レイヤーへ現在の hillshadeLevel を反映する。
 */
function applyHillshade() {
  if (!map || !map.getLayer('hillshade')) return;
  const exaggeration = HILLSHADE_EXAGGERATION[hillshadeLevel] ?? 0;
  if (exaggeration === 0) {
    map.setLayoutProperty('hillshade', 'visibility', 'none');
    return;
  }
  map.setPaintProperty('hillshade', 'hillshade-exaggeration', exaggeration);
  map.setLayoutProperty('hillshade', 'visibility', 'visible');
}

/**
 * 陰影起伏図レイヤーのレベル切替（Issue #48: off / weak / strong）。
 */
export function setHillshadeLevel(level) {
  hillshadeLevel = level;
  applyHillshade();
}
