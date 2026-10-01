export async function lookupPincode(pincode) {
  const pin = String(pincode || "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(pin)) throw new Error("Invalid Indian pincode");
  const response = await fetch(`https://api.postalpincode.in/pincode/${pin}`);
  if (!response.ok) throw new Error("Pincode service unavailable");
  const data = await response.json();
  const result = data?.[0];
  if (result?.Status !== "Success" || !result.PostOffice?.length)
    throw new Error("Pincode not found");
  const postOffice = result.PostOffice[0];
  return {
    district: postOffice.District || "",
    state: postOffice.State || "",
    city: postOffice.Name || postOffice.District || "",
  };
}
