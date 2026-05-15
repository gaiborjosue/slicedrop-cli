export function buildViewerUrl(viewerBase, fileUrl, fileName) {
  const viewer = new URL(viewerBase);
  viewer.searchParams.set("url", fileUrl);
  viewer.searchParams.set("name", fileName);
  return viewer.toString();
}

export function buildProxyUrl(proxyBase, targetUrl) {
  const proxy = new URL(proxyBase);
  proxy.searchParams.set("url", targetUrl);
  return proxy.toString();
}
