// Stand-in for virtual:pwa-register/react in the single-file preview build,
// which has no service worker.
export function useRegisterSW() {
  return {
    needRefresh: [false, () => {}] as [boolean, (v: boolean) => void],
    offlineReady: [false, () => {}] as [boolean, (v: boolean) => void],
    updateServiceWorker: async (_reload?: boolean) => {},
  };
}
