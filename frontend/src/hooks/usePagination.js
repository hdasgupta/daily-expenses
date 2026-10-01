import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";

const defaultState = {
  pageSize: 10,
  search: "",
  sortColumn: null,
  sortDirection: "asc",
};

export function usePagination(module, defaultSort = null) {
  const [state, setState] = useState({
    ...defaultState,
    sortColumn: defaultSort,
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    api(`/pagination/${encodeURIComponent(module)}`, {
      loadingMessage: "Loading pagination settings…",
    })
      .then((saved) => {
        if (!active) return;
        setState({
          pageSize: [5, 10, 20, 50].includes(Number(saved.page_size))
            ? Number(saved.page_size)
            : 10,
          search: saved.search_text || "",
          sortColumn: saved.sort_column || defaultSort,
          sortDirection: saved.sort_direction === "desc" ? "desc" : "asc",
        });
      })
      .catch(() => {})
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [module, defaultSort]);

  const setPageSize = useCallback((pageSize) => {
    setState((current) => ({ ...current, pageSize: Number(pageSize) }));
  }, []);
  const setSearch = useCallback((search) => {
    setState((current) => ({ ...current, search }));
  }, []);
  const setSort = useCallback((column) => {
    setState((current) => ({
      ...current,
      sortColumn: column,
      sortDirection:
        current.sortColumn === column && current.sortDirection === "asc" ? "desc" : "asc",
    }));
  }, []);

  useEffect(() => {
    if (!ready) return undefined;
    const timer = setTimeout(() => {
      api(`/pagination/${encodeURIComponent(module)}`, {
        method: "PUT",
        body: JSON.stringify(state),
        loadingMessage: "Saving pagination setting…",
        silent: true,
      }).catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [module, ready, state]);

  return { ...state, setPageSize, setSearch, setSort, ready };
}
