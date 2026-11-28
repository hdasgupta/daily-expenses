import {
  getItemPriceTrend,
  getItemsWithPriceTrendData,
  getSmartUnitForItem,
  getUserPriceTrendPreferences,
  saveUserPriceTrendPreferences,
} from "../services/priceTrendService.js";

export async function getPriceTrend(req, res) {
  res.json(
    await getItemPriceTrend({
      locationId: req.query.locationId,
      categoryId: req.query.categoryId,
      itemId: req.query.itemId,
      unitId: req.query.unitId,
    }),
  );
}

export async function getSmartUnit(req, res) {
  res.json(
    await getSmartUnitForItem({
      locationId: req.query.locationId,
      categoryId: req.query.categoryId,
      itemId: req.query.itemId,
    }),
  );
}

export async function getPreferences(req, res) {
  res.json(await getUserPriceTrendPreferences(req.user.id));
}

export async function savePreferences(req, res) {
  res.json(await saveUserPriceTrendPreferences(req.user.id, req.body || {}));
}

export async function getItemsWithData(req, res) {
  res.set("Cache-Control", "private, no-cache");
  const rows = await getItemsWithPriceTrendData({
    categoryId: req.query.categoryId,
    locationId: req.query.locationId,
  });
  res.json(rows);
}
