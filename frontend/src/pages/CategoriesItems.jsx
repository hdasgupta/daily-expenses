import React, { useEffect, useState } from "react";
import { Edit3, Plus, RotateCcw, Tags, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import Pagination from "../components/Pagination";
import Modal from "../components/Modal";
import ConfirmDialog from "../components/ConfirmDialog";
import { usePagination } from "../hooks/usePagination";

export default function CategoriesItems() {
  const pagination = usePagination("items", "name");
  const [categories, setCategories] = useState([]);
  const [categoryId, setCategoryId] = useState("");
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [categoryModal, setCategoryModal] = useState(null);
  const [categoryName, setCategoryName] = useState("");
  const [itemModal, setItemModal] = useState(null);
  const [itemName, setItemName] = useState("");
  const [itemCategoryId, setItemCategoryId] = useState("");
  const [deleteCategoryId, setDeleteCategoryId] = useState(null);
  const [deleteItemId, setDeleteItemId] = useState(null);

  const loadCategories = () =>
    api("/categories", { loadingMessage: "Loading categories…" }).then(setCategories);
  const loadItems = async () => {
    if (!categoryId || !pagination.ready) return;
    const result = await api(
      `/items?categoryId=${categoryId}&page=${page}&pageSize=${pagination.pageSize}&search=${encodeURIComponent(pagination.search)}&sortColumn=${encodeURIComponent(pagination.sortColumn || "name")}&sortDirection=${pagination.sortDirection}`,
      { loadingMessage: "Loading items…" },
    );
    setItems(result.rows);
    setTotal(result.total);
  };

  useEffect(() => {
    loadCategories().catch(() => {});
  }, []);
  useEffect(() => {
    loadItems().catch(() => {});
  }, [
    categoryId,
    page,
    pagination.pageSize,
    pagination.search,
    pagination.sortColumn,
    pagination.sortDirection,
    pagination.ready,
  ]);
  useEffect(() => {
    setPage(1);
  }, [pagination.search, pagination.pageSize, categoryId]);

  const submitCategory = async (event) => {
    event.preventDefault();
    if (categoryModal?.mode === "edit")
      await api(`/categories/${categoryModal.id}`, {
        method: "PUT",
        body: JSON.stringify({ name: categoryName }),
        loadingMessage: "Updating category…",
      });
    else
      await api("/categories", {
        method: "POST",
        body: JSON.stringify({ name: categoryName }),
        loadingMessage: "Adding category…",
      });
    await loadCategories();
    setCategoryModal(null);
    setCategoryName("");
  };

  const submitItem = async (event) => {
    event.preventDefault();
    if (itemModal?.mode === "edit")
      await api(`/items/${itemModal.id}`, {
        method: "PUT",
        body: JSON.stringify({ categoryId: itemCategoryId, name: itemName }),
        loadingMessage: "Updating item…",
      });
    else
      await api("/items", {
        method: "POST",
        body: JSON.stringify({ categoryId: itemCategoryId, name: itemName }),
        loadingMessage: "Adding item…",
      });
    setItemModal(null);
    setItemName("");
    setItemCategoryId(categoryId);
    await loadItems();
  };

  const removeCategory = async () => {
    await api(`/categories/${deleteCategoryId}`, {
      method: "DELETE",
      loadingMessage: "Removing category…",
    });
    setDeleteCategoryId(null);
    setCategoryId("");
    await loadCategories();
    setItems([]);
  };

  const removeItem = async () => {
    await api(`/items/${deleteItemId}`, { method: "DELETE", loadingMessage: "Removing item…" });
    setDeleteItemId(null);
    await loadItems();
  };

  const addCategory = () => {
    setCategoryName("");
    setCategoryModal({ mode: "add" });
  };
  const editCategory = () => {
    const category = categories.find((item) => String(item.id) === String(categoryId));
    setCategoryName(category?.name || "");
    setCategoryModal({ mode: "edit", id: categoryId });
  };
  const addItem = () => {
    setItemName("");
    setItemCategoryId(categoryId);
    setItemModal({ mode: "add" });
  };

  return (
    <section>
      <div className="page-heading">
        <div>
          <h1>Categories & Items</h1>
          <p>Categories control which items are available in the expense form.</p>
        </div>
      </div>
      <div className="card category-toolbar">
        <label>
          Category
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Select category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <div className="toolbar-actions">
          <button className="secondary" onClick={addCategory}>
            <Plus size={17} /> Add category
          </button>
          <button className="secondary" disabled={!categoryId} onClick={editCategory}>
            <Edit3 size={17} /> Update category
          </button>
          <button
            className="danger"
            disabled={!categoryId}
            onClick={() => setDeleteCategoryId(categoryId)}
          >
            <Trash2 size={17} /> Remove category
          </button>
        </div>
      </div>

      {categoryId ? (
        <>
          <button className="primary add-row-button" onClick={addItem}>
            <Plus size={18} /> Add item
          </button>
          <Pagination
            page={page}
            setPage={setPage}
            total={total}
            {...pagination}
            sortOptions={[
              { value: "name", label: "Item" },
              { value: "category", label: "Category" },
            ]}
          />
          <div className="list-stack">
            {items.map((item) => (
              <article className="list-card" key={item.id}>
                <div className="list-main">
                  <strong>{item.name}</strong>
                  <span>{item.category}</span>
                </div>
                <div className="row-actions">
                  <button
                    className="icon-button soft"
                    title="Update item"
                    onClick={() => {
                      setItemName(item.name);
                      setItemCategoryId(item.category_id);
                      setItemModal({ mode: "edit", id: item.id });
                    }}
                  >
                    <Edit3 size={17} />
                  </button>
                  <button
                    className="icon-button danger-soft"
                    title="Remove item"
                    onClick={() => setDeleteItemId(item.id)}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </article>
            ))}
            {!items.length ? <div className="empty-card">No items in this category.</div> : null}
          </div>
          <Pagination
            page={page}
            setPage={setPage}
            total={total}
            {...pagination}
            sortOptions={[
              { value: "name", label: "Item" },
              { value: "category", label: "Category" },
            ]}
          />
          <button className="primary add-row-button" onClick={addItem}>
            <Plus size={18} /> Add item
          </button>
        </>
      ) : (
        <div className="empty-card">
          <Tags size={30} />
          <span>Select a category to manage its items.</span>
        </div>
      )}

      <Modal
        open={Boolean(categoryModal)}
        title={categoryModal?.mode === "edit" ? "Update category" : "Add category"}
        onClose={() => setCategoryModal(null)}
        footer={
          <>
            <button className="secondary" onClick={() => setCategoryModal(null)}>
              Cancel
            </button>
            <button
              className="secondary"
              type="reset"
              form="category-form"
              onClick={() => setCategoryName("")}
            >
              <RotateCcw size={15} /> Reset
            </button>
            <button className="primary" form="category-form">
              {categoryModal?.mode === "edit" ? "Update" : "Add"}
            </button>
          </>
        }
      >
        <form id="category-form" className="form-stack" onSubmit={submitCategory}>
          <label>
            Category name
            <input
              required
              autoFocus
              value={categoryName}
              onChange={(e) => setCategoryName(e.target.value)}
            />
          </label>
        </form>
      </Modal>
      <Modal
        open={Boolean(itemModal)}
        title={itemModal?.mode === "edit" ? "Update item" : "Add item"}
        onClose={() => setItemModal(null)}
        footer={
          <>
            <button className="secondary" onClick={() => setItemModal(null)}>
              Cancel
            </button>
            <button
              className="secondary"
              type="reset"
              form="item-form"
              onClick={() => {
                setItemName("");
                setItemCategoryId(categoryId);
              }}
            >
              <RotateCcw size={15} /> Reset
            </button>
            <button className="primary" form="item-form">
              {itemModal?.mode === "edit" ? "Update" : "Add"}
            </button>
          </>
        }
      >
        <form id="item-form" className="form-stack" onSubmit={submitItem}>
          <label>
            Category
            <select
              required
              value={itemCategoryId}
              onChange={(e) => setItemCategoryId(e.target.value)}
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Item name
            <input
              required
              autoFocus
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
            />
          </label>
        </form>
      </Modal>
      <ConfirmDialog
        open={Boolean(deleteCategoryId)}
        message="The category and all items under it will be removed. Existing expenses keep their category relationship only if the database allows it; otherwise the operation is blocked."
        onCancel={() => setDeleteCategoryId(null)}
        onConfirm={removeCategory}
      />
      <ConfirmDialog
        open={Boolean(deleteItemId)}
        message="This will permanently remove the selected item."
        onCancel={() => setDeleteItemId(null)}
        onConfirm={removeItem}
      />
    </section>
  );
}
