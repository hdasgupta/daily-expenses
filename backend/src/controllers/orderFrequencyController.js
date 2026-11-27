import {
  getItemOrderFrequency,
  getItemsWithOrderFrequencyData,
  getUserOrderFrequencyPreferences,
  saveUserOrderFrequencyPreferences,
} from "../services/orderFrequencyService.js";

export async function getOrderFrequency(req, res) {
  const data = await getItemOrderFrequency({
    locationId: req.query.locationId,
    categoryId: req.query.categoryId,
    itemId: req.query.itemId,
    unitId: req.query.unitId,
  });
  res.json(data);
}

export async function getPreferences(req, res) {
  const data = await getUserOrderFrequencyPreferences(req.user.id);
  res.json(data);
}

export async function savePreferences(req, res) {
  const data = await saveUserOrderFrequencyPreferences(req.user.id, req.body || {});
  res.json(data);
}

export async function getItemsWithData(req, res) {
  const rows = await getItemsWithOrderFrequencyData({
    categoryId: req.query.categoryId,
    locationId: req.query.locationId,
  });
  res.json(rows);
}
