import {
  createSurvivor,
  deleteSurvivor,
  listSurvivors,
  listSurvivorsForMeta,
  updateSurvivor,
} from "../models/survivorModel.js";
import { optionalText, requiredText } from "../utils/validation.js";

function normalize(data) {
  const pincode = String(data.pincode || "")
    .replace(/\D/g, "")
    .slice(0, 6);
  return {
    fullName: requiredText(data.fullName, "Full name"),
    fatherName: optionalText(data.fatherName),
    motherName: optionalText(data.motherName),
    nickname: optionalText(data.nickname),
    houseNo: optionalText(data.houseNo),
    street: optionalText(data.street),
    area: optionalText(data.area),
    villageCity: optionalText(data.villageCity),
    pincode: pincode || null,
    district: optionalText(data.district),
    state: optionalText(data.state),
  };
}

export async function saveSurvivor(data) {
  return createSurvivor(normalize(data));
}

export async function editSurvivor(id, data) {
  return updateSurvivor(id, normalize(data));
}

export { deleteSurvivor, listSurvivors, listSurvivorsForMeta };
