import { sendAdminFailureAlert } from "./mailService.js";

export async function notifyAdminFailure(details = {}) {
  try { await sendAdminFailureAlert(details); }
  catch (error) { console.error("Failed to send admin failure alert", { message:error?.message||String(error), stack:error?.stack }); }
}
