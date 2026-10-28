// OWNER: C. Small helpers shared by C's route handlers.
import { copy } from "@/lib/copy";
import type { ThroneId } from "@/lib/contracts";
import { hashIp } from "../hash";
import { HttpError, clientIp, deviceId } from "../http";
import type { Requester } from "./reservations";
import { isThroneId } from "./state";

export const RESERVATION_TOKEN_HEADER = "x-reservation-token";

export function throneParam(value: string): ThroneId {
  if (!isThroneId(value)) throw new HttpError(404, "unknown_throne", copy.core.errUnknownThrone);
  return value;
}

export function requester(req: Request): Requester {
  return { ipHash: hashIp(clientIp(req)), deviceId: deviceId(req) };
}

export function reservationToken(req: Request): string | null {
  return req.headers.get(RESERVATION_TOKEN_HEADER);
}
