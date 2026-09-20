import { createContext, useContext } from 'react';

export const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export const FilterCtx = createContext(null);
export const useGlobalFilters = () => useContext(FilterCtx);
export function navigate(path) {
  window.location.hash = path;
}
