/**
 * navigator.geolocation.watchPosition のラッパー。
 */

const OPTIONS = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 0,
};

/**
 * @param {(pos: {lat: number, lon: number, speed: number|null}) => void} onSuccess
 * @param {(err: GeolocationPositionError) => void} onError
 * @returns {number} watchId
 */
export function startWatching(onSuccess, onError) {
  if (!('geolocation' in navigator)) {
    onError({ code: 2, message: 'Geolocation API not available' });
    return -1;
  }
  return navigator.geolocation.watchPosition(
    (position) => {
      onSuccess({
        lat: position.coords.latitude,
        lon: position.coords.longitude,
        speed: position.coords.speed,
      });
    },
    onError,
    OPTIONS,
  );
}

export function stopWatching(watchId) {
  if (watchId >= 0) navigator.geolocation.clearWatch(watchId);
}
