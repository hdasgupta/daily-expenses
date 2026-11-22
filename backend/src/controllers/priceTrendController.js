import { getItemPriceTrend } from "../services/priceTrendService.js";

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
