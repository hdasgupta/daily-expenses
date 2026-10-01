import {
  createCategory,
  createItem,
  createUnit,
  deleteCategory,
  deleteItem,
  deleteUnit,
  listCategories,
  listItems,
  listItemsForMeta,
  listUnits,
  listUnitsForMeta,
  updateCategory,
  updateItem,
  updateUnit,
} from "../models/masterDataModel.js";
import { requiredText } from "../utils/validation.js";

export { listCategories, listItems, listItemsForMeta, listUnits, listUnitsForMeta };

export async function addCategory(name) {
  return createCategory(requiredText(name, "Category name"));
}

export async function editCategory(id, name) {
  return updateCategory(id, requiredText(name, "Category name"));
}

export async function addItem(categoryId, name) {
  if (!categoryId) throw new Error("Category is required");
  return createItem(categoryId, requiredText(name, "Item name"));
}

export async function editItem(id, categoryId, name) {
  if (!categoryId) throw new Error("Category is required");
  return updateItem(id, categoryId, requiredText(name, "Item name"));
}

export async function addUnit(name) {
  return createUnit(requiredText(name, "Unit name"));
}

export async function editUnit(id, name) {
  return updateUnit(id, requiredText(name, "Unit name"));
}

export { deleteCategory, deleteItem, deleteUnit };
