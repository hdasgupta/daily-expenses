export const authSql = {
  invalidateOtps:
    "UPDATE public.password_otps SET used=true WHERE lower(email)=lower($1) AND used=false",
  createOtp: "INSERT INTO public.password_otps(email,otp_hash,expires_at) VALUES($1,$2,$3)",
  latestOtp: `SELECT id,otp_hash FROM public.password_otps
    WHERE lower(email)=lower($1) AND used=false AND expires_at > now()
    ORDER BY created_at DESC LIMIT 1`,
  updatePassword:
    "UPDATE public.users SET password_hash=$1,updated_at=now() WHERE lower(email)=lower($2)",
  useOtp: "UPDATE public.password_otps SET used=true WHERE id=$1",
};
