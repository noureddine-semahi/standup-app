// A full-page navigation, behind one function so it can be replaced in tests (browsers don't allow `window.location.assign` to be stubbed).
export function navigateTo(url: string): void {
  window.location.assign(url);
}
