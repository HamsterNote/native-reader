const token = document.currentScript?.dataset.hnCspProbeToken;
if (typeof token === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(token)) {
  const marker = document.createElement('meta');
  marker.name = 'hn-csp-external-probe';
  marker.content = token;
  document.head.append(marker);
}
