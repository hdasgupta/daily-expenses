import React from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";

export default function Pagination({
  page,
  total,
  pageSize,
  setPage,
  setPageSize,
  search,
  setSearch,
  sortColumn,
  sortDirection,
  setSort,
  sortOptions = [],
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  const pageNumbers = Array.from({ length: Math.min(pages, 7) }, (_, index) => {
    if (pages <= 7) return index + 1;
    if (current <= 4) return index + 1;
    if (current >= pages - 3) return pages - 6 + index;
    return current - 3 + index;
  });

  return (
    <div className="pagination">
      <div className="pagination-left">
        <button
          className="page-button"
          disabled={current <= 1}
          onClick={() => setPage(current - 1)}
          title="Previous"
        >
          <ChevronLeft size={16} /> Prev
        </button>
        {pageNumbers.map((number) => (
          <button
            key={number}
            className={`page-button ${number === current ? "active" : ""}`}
            onClick={() => setPage(number)}
          >
            {number}
          </button>
        ))}
        <button
          className="page-button"
          disabled={current >= pages}
          onClick={() => setPage(current + 1)}
          title="Next"
        >
          Next <ChevronRight size={16} />
        </button>
      </div>
      <div className="pagination-controls">
        <label>
          Items/page
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
          >
            <option value="5">5</option>
            <option value="10">10</option>
            <option value="20">20</option>
            <option value="50">50</option>
          </select>
        </label>
        {sortOptions.length ? (
          <label>
            Sort
            <select
              value={sortColumn || ""}
              onChange={(e) => {
                setSort(e.target.value || null);
                setPage(1);
              }}
            >
              <option value="">Default</option>
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {sortColumn ? (
          <button
            className="page-button sort-direction"
            onClick={() => {
              setSort(sortColumn);
              setPage(1);
            }}
          >
            {sortDirection === "asc" ? "↑" : "↓"}
          </button>
        ) : null}
        <label className="search-box">
          <Search size={15} />
          <input
            placeholder="Search"
            value={search || ""}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </label>
      </div>
    </div>
  );
}
