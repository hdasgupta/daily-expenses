import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
export default function Pagination({
  page,
  total,
  pageSize,
  setPage,
  setPageSize,
  search,
  setSearch,
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pager">
      <div>
        <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
          <ChevronLeft size={16} />
        </button>
        {Array.from({ length: Math.min(5, pages) }, (_, i) => {
          const p = Math.min(pages, Math.max(1, page - 2 + i));
          return (
            <button
              className={p === page ? "active" : ""}
              key={p}
              onClick={() => setPage(p)}
            >
              {p}
            </button>
          );
        })}
        <button disabled={page >= pages} onClick={() => setPage(page + 1)}>
          <ChevronRight size={16} />
        </button>
      </div>
      <input
        placeholder="Search"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
      />
      <select
        value={pageSize}
        onChange={(e) => {
          setPageSize(+e.target.value);
          setPage(1);
        }}
      >
        {[5, 10, 20, 50].map((n) => (
          <option key={n}>{n}</option>
        ))}
      </select>
      <span>{total} items</span>
    </div>
  );
}
