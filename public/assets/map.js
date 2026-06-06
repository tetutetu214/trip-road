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
// 起動時は宇宙から見た地球俯瞰の画から始め、GPS 確定時に現在地へ
// 一気に寄せる「ズームイン」の演出を出す。center は本州中央付近で、
// 地球上に日本が正面に来るようにする。
// Standard スタイルは低ズームで自動的に globe（地球が丸く見える投影）になる。
// INITIAL_ZOOM を下げるほど地球全体が画面に収まる。
const INITIAL_CENTER = [137.5, 37.5]; // [lng, lat]
const INITIAL_ZOOM = 1.2;
const FIRST_FIX_ZOOM = 14;
// GPS 初回確定までに自転で待たせる演出。これ以上寄ったら自転しない
// （flyTo の途中で moveend が誤って自転を再開しないためのガード）。
const SPIN_MAX_ZOOM = 5;
// 地球が一周するのにかける秒数。大きいほどゆっくり回る。
const SECONDS_PER_REVOLUTION = 180;

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
// 地球俯瞰の自転演出が有効か。GPS 初回確定 or ユーザー操作で止める。
// GPS が来ない間は止めない（地球は同じ向きに回り続けるのが自然なため）。
let spinEnabled = false;
// 初回ズームイン（地球俯瞰 → 現在地）を済ませたか。
// app 側の isFirst フラグだけに頼ると、style.load が遅れて初回 fix が
// pendingLocation 経由になったとき isFirst=false に上書きされ flyTo が
// 発火しない事故が起きる。地図側でも「まだ寄っていない」を持って二重で守る。
let didInitialZoom = false;
// 初回ズームインの flyTo が飛行中か。飛行中は後続の GPS 更新による
// 中心追従(easeTo)を見送らないと、flyTo が途中で打ち切られて低ズームのまま
// 止まってしまう（watchPosition が毎秒位置を送るため起きる）。
let initialFlyInProgress = false;

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
 * 地球をわずかに西へ回す。moveend で再帰的に呼ばれ続けることで
 * 一定速度の自転になる（easeTo 完了 → moveend 発火 → 次の easeTo）。
 * SPIN_MAX_ZOOM 以上に寄っている間は何もしない（flyTo 中の誤発火対策）。
 */
function spinGlobe() {
  if (!spinEnabled || !map) return;
  if (map.getZoom() >= SPIN_MAX_ZOOM) return;
  const distancePerSecond = 360 / SECONDS_PER_REVOLUTION;
  const center = map.getCenter();
  center.lng -= distancePerSecond;
  // easing を線形(n => n)にして等速回転にする。duration と回転量を合わせる。
  map.easeTo({ center, duration: 1000, easing: (n) => n });
}

/**
 * 自転を止める。GPS 確定・ユーザー操作時に呼ぶ。
 */
function stopSpin() {
  spinEnabled = false;
}

/**
 * Mapbox 地図を初期化する。token は Workers 経由で取得した公開トークン(pk)。
 */
export function initMap(containerId, token) {
  mapboxgl.accessToken = token;
  map = new mapboxgl.Map({
    container: containerId,
    style: STANDARD_STYLE,
    projection: 'globe', // 地球俯瞰。Standard は既定で globe だが意図を明示する。
    center: INITIAL_CENTER,
    zoom: INITIAL_ZOOM,
    attributionControl: true, // 規約上、出典表記は表示したまま
  });

  // 地球俯瞰の自転演出のセットアップ。
  // prefers-reduced-motion（動きを減らす設定）の端末では酔い対策で自転しない。
  const reduceMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduceMotion) {
    spinEnabled = true;
    // moveend ごとに次の一手を打つことで継続的な自転になる。
    map.on('moveend', spinGlobe);
    // ユーザーが地図を触ったら主導権を渡し、自転は止める。
    map.on('dragstart', stopSpin);
    // 初回キック（load 後に最初の easeTo を発火させる）。
    map.on('load', spinGlobe);
  }

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
        // hillshade-exaggeration の変更を即時反映（既定の約300msアニメを無効化）。
        // OFF時は visibility:none にするだけで誇張値は前回値(strong=1.0)が残るため、
        // 次の OFF→弱 表示時に 1.0→0.7 のアニメが走り「一瞬濃く→薄く」見えてしまう。
        // duration:0 で値をスナップさせ、このちらつきを消す。
        paint: {
          'hillshade-exaggeration': HILLSHADE_EXAGGERATION.weak,
          'hillshade-exaggeration-transition': { duration: 0 },
        },
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
  // 初回ズームは「app 側の isFirst」だけでなく「まだ寄っていないか」でも判定する。
  // globe 描画で style.load が遅れると初回 fix が pendingLocation 経由になり、
  // 2 件目以降で isFirst=false に上書きされて flyTo が一度も発火しない事故を防ぐ。
  if (isFirst || !didInitialZoom) {
    // 初回の位置確定: 地球俯瞰の自転を止め、現在地へ一気に寄る演出。
    // flyTo は最短経路で現在地へ寄せる。flyTo に遠回りの経度（lon-360 等）を
    // 渡すと「距離が大きい」と判断して大きくズームアウトしてしまい、
    // かえって寄らなくなるため、素直に [lon, lat] を渡す。
    const DURATION = 4500;
    didInitialZoom = true;
    stopSpin();
    // 飛行中は後続 GPS 更新の easeTo を抑止する（割り込みで途中停止しないため）。
    initialFlyInProgress = true;
    map.flyTo({
      center: [lon, lat],
      zoom: FIRST_FIX_ZOOM,
      duration: DURATION,
      curve: 1.6,
      essential: true, // prefers-reduced-motion でも実行（追従に必要なため）
    });
    // 飛行完了で抑止解除。moveend が来ない異常時に備え duration 経過でも解除。
    map.once('moveend', () => {
      initialFlyInProgress = false;
    });
    setTimeout(() => {
      initialFlyInProgress = false;
    }, DURATION + 1000);
  } else {
    // 初回ズームイン飛行中は中心追従を見送る（flyTo を止めないため）。
    // マーカー位置は上で更新済みなので現在地マーカーは動き続ける。
    if (initialFlyInProgress) return;
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
