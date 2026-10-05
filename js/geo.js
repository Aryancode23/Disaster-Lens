/* Disaster Lens – geography helpers (Phase 5)
 * Pure functions, no network, no keys. The map, the heatmap and the privacy rules all
 * use these. Place names below are approximate CITY CENTRES, used only to (a) label the
 * map and (b) show a report that has no GPS at its city, clearly marked as approximate.
 */
(function () {
  window.DL = window.DL || {};

  /* name, latitude, longitude, importance (1 = biggest) */
  var CITIES = [
    ['Delhi', 28.61, 77.21, 1], ['Mumbai', 19.08, 72.88, 1], ['Kolkata', 22.57, 88.36, 1], ['Chennai', 13.08, 80.27, 1], ['Bengaluru', 12.97, 77.59, 1], ['Hyderabad', 17.39, 78.49, 1],
    ['Ahmedabad', 23.02, 72.57, 2], ['Pune', 18.52, 73.86, 2], ['Jaipur', 26.91, 75.79, 2], ['Lucknow', 26.85, 80.95, 2], ['Kanpur', 26.45, 80.35, 2], ['Nagpur', 21.15, 79.09, 2],
    ['Indore', 22.72, 75.86, 2], ['Bhopal', 23.26, 77.41, 2], ['Patna', 25.59, 85.14, 2], ['Surat', 21.17, 72.83, 2], ['Visakhapatnam', 17.69, 83.22, 2], ['Varanasi', 25.32, 83.01, 2],
    ['Thiruvananthapuram', 8.52, 76.94, 3], ['Kochi', 9.93, 76.27, 3], ['Coimbatore', 11.02, 76.96, 3], ['Chandigarh', 30.73, 76.78, 3], ['Ludhiana', 30.90, 75.86, 3], ['Amritsar', 31.63, 74.87, 3],
    ['Dehradun', 30.32, 78.03, 3], ['Ranchi', 23.34, 85.31, 3], ['Raipur', 21.25, 81.63, 3], ['Bhubaneswar', 20.30, 85.82, 3], ['Guwahati', 26.14, 91.74, 3], ['Vadodara', 22.31, 73.18, 3],
    ['Prayagraj', 25.44, 81.85, 3], ['Agra', 27.18, 78.02, 3], ['Meerut', 28.98, 77.71, 3], ['Ghaziabad', 28.67, 77.45, 3], ['Noida', 28.54, 77.39, 3], ['Gorakhpur', 26.76, 83.37, 3],
    ['Mirzapur', 25.15, 82.57, 4], ['Bareilly', 28.37, 79.43, 4], ['Aligarh', 27.88, 78.08, 4], ['Moradabad', 28.84, 78.78, 4], ['Jhansi', 25.45, 78.57, 4], ['Faridabad', 28.41, 77.31, 4],
    ['Gurugram', 28.46, 77.03, 4], ['Madurai', 9.93, 78.12, 4], ['Tiruchirappalli', 10.79, 78.70, 4], ['Mysuru', 12.30, 76.64, 4], ['Mangaluru', 12.91, 74.86, 4], ['Panaji', 15.50, 73.83, 4],
    ['Imphal', 24.82, 93.94, 4], ['Shillong', 25.57, 91.88, 4], ['Aizawl', 23.73, 92.72, 4], ['Kohima', 25.67, 94.11, 4], ['Agartala', 23.83, 91.28, 4], ['Gangtok', 27.33, 88.61, 4],
    ['Itanagar', 27.08, 93.61, 4], ['Puducherry', 11.93, 79.83, 4], ['Port Blair', 11.62, 92.73, 4], ['Leh', 34.15, 77.58, 4], ['Srinagar', 34.08, 74.80, 3], ['Jammu', 32.73, 74.87, 4],
    ['Shimla', 31.10, 77.17, 4], ['Jodhpur', 26.24, 73.02, 3], ['Udaipur', 24.58, 73.71, 4], ['Kota', 25.18, 75.84, 4], ['Ajmer', 26.45, 74.64, 4], ['Jabalpur', 23.18, 79.99, 4],
    ['Gwalior', 26.22, 78.18, 4], ['Nashik', 20.00, 73.79, 4], ['Aurangabad', 19.88, 75.34, 4], ['Rajkot', 22.30, 70.80, 4], ['Vijayawada', 16.51, 80.65, 4], ['Warangal', 17.98, 79.59, 4],
    ['Dhanbad', 23.80, 86.43, 4], ['Jamshedpur', 22.80, 86.20, 4], ['Siliguri', 26.73, 88.43, 4], ['Howrah', 22.59, 88.31, 4], ['Asansol', 23.68, 86.98, 4]
  ];
  var ALIAS = { bangalore: 'bengaluru', allahabad: 'prayagraj', gurgaon: 'gurugram', bombay: 'mumbai', calcutta: 'kolkata', madras: 'chennai', trivandrum: 'thiruvananthapuram',
    vizag: 'visakhapatnam', 'new delhi': 'delhi', cochin: 'kochi', benares: 'varanasi', banaras: 'varanasi', mysore: 'mysuru', baroda: 'vadodara', trichy: 'tiruchirappalli', pondicherry: 'puducherry' };

  var byName = {};
  CITIES.forEach(function (c) { byName[c[0].toLowerCase()] = { name: c[0], lat: c[1], lng: c[2], rank: c[3] }; });

  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function lookup(name) {
    var k = norm(name);
    if (!k) return null;
    k = ALIAS[k] || k;
    return byName[k] || null;
  }
  function suggest(prefix, limit) {
    var k = norm(prefix), out = [];
    if (k.length < 2) return out;
    CITIES.forEach(function (c) { if (c[0].toLowerCase().indexOf(k) === 0) out.push(c[0]); });
    return out.slice(0, limit || 6);
  }

  /* A coordinate is only accepted when it is a real number inside India's bounding box. */
  var BOUNDS = { south: 6, north: 38, west: 68, east: 98 };
  function valid(lat, lng) {
    lat = Number(lat); lng = Number(lng);
    return isFinite(lat) && isFinite(lng) && lat >= BOUNDS.south && lat <= BOUNDS.north && lng >= BOUNDS.west && lng <= BOUNDS.east;
  }

  /* Public maps never show an exact spot: the point is moved to the centre of a square cell. */
  function snap(lat, lng, meters) {
    var step = Math.max(50, meters) / 111320;
    var la = (Math.floor(lat / step) + 0.5) * step;
    var lngStep = step / Math.max(0.2, Math.cos(la * Math.PI / 180));
    return { lat: la, lng: (Math.floor(lng / lngStep) + 0.5) * lngStep };
  }

  function km(a, b) {
    var R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
  }

  /* Web Mercator, the same maths every web map uses, so a street-map background lines up if it is switched on. */
  function project(lat, lng, z) {
    var size = 256 * Math.pow(2, z), s = Math.max(-0.9999, Math.min(0.9999, Math.sin(lat * Math.PI / 180)));
    return { x: (lng + 180) / 360 * size, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size };
  }
  function unproject(x, y, z) {
    var size = 256 * Math.pow(2, z), n = Math.PI - 2 * Math.PI * y / size;
    return { lat: 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lng: x / size * 360 - 180 };
  }

  window.DL.geo = { CITIES: CITIES, lookup: lookup, suggest: suggest, valid: valid, snap: snap, km: km, project: project, unproject: unproject, BOUNDS: BOUNDS, norm: norm,
    INDIA: { lat: 22.6, lng: 79.0, zoom: 4.6 } };
})();
