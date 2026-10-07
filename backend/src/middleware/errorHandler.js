import { notifyAdminFailure } from "../services/adminAlertService.js";

function getRequestUser(req) {
  if (!req?.user) return null;
  return { fullName:req.user.full_name||req.user.fullName||null, email:req.user.email||null };
}
export function notFound(req,res){ res.status(404).json({error:"Route not found"}); }
export function errorHandler(error,req,res,next){
  if(res.headersSent) return next(error);
  console.error(error);
  const statusCode=error.statusCode||500;
  const failureMessage=error?.message||"Internal server error";
  if(statusCode>=500) void notifyAdminFailure({category:"backend-runtime",failureTime:new Date().toISOString(),failureMessage,stack:error?.stack,method:req?.method,path:req?.originalUrl||req?.url,requestId:req?.requestId,user:getRequestUser(req)});
  if(error?.code==="23505") return res.status(409).json({error:"A value with that name already exists"});
  if(error?.code==="23503") return res.status(409).json({error:"The record is still in use"});
  if(error?.code==="LIMIT_FILE_SIZE") return res.status(413).json({error:"Uploaded file is too large"});
  res.status(statusCode).json({error:failureMessage});
}
