/* Shared meeting rooms — port of server/rooms.py onto a Durable Object.
 *
 * One DO instance per room, addressed by the friendly room id via
 * `getByName`, so a share link like /r/sunny-otter always lands on the same
 * object. Rooms expire ROOM_TTL_MS after the last write: reads treat stale
 * rooms as gone, and an alarm wipes the storage so expired rooms cost
 * nothing at rest.
 */

import { DurableObject } from "cloudflare:workers";

import { randomName } from "./words";

const ROOM_TTL_MS = 24 * 3600 * 1000;
// Every located participant costs a Transitous one-to-all query per search,
// so keep rooms small out of fair-use politeness.
export const MAX_PARTICIPANTS = 5;

export interface Participant {
  id: string;
  order: number;
  name: string;
  lat: number | null;
  lon: number | null;
  label: string | null;
}

/* Results cross the RPC boundary as pre-encoded JSON text: the payload is
 * arbitrary search output, and neither `unknown` nor a recursive JSON type
 * survives the RPC serializable-type machinery. */
interface RoomView {
  participants: Participant[];
  resultsJson: string | null;
  resultsVersion: number;
}

interface RoomData {
  joinCounter: number;
  participants: Record<string, Participant>;
  resultsJson: string | null;
  resultsVersion: number;
  touched: number;
}

export class Room extends DurableObject<Env> {
  /** Room data if this room exists and hasn't expired. */
  private async live(): Promise<RoomData | null> {
    const room = await this.ctx.storage.get<RoomData>("room");
    if (!room) return null;
    if (Date.now() - room.touched > ROOM_TTL_MS) {
      await this.ctx.storage.deleteAll();
      await this.ctx.storage.deleteAlarm();
      return null;
    }
    return room;
  }

  private async save(room: RoomData): Promise<void> {
    room.touched = Date.now();
    await this.ctx.storage.put("room", room);
    await this.ctx.storage.setAlarm(room.touched + ROOM_TTL_MS);
  }

  async alarm(): Promise<void> {
    const room = await this.ctx.storage.get<RoomData>("room");
    if (!room || Date.now() - room.touched >= ROOM_TTL_MS) {
      await this.ctx.storage.deleteAll();
    } else {
      // A write moved the expiry after this alarm was set.
      await this.ctx.storage.setAlarm(room.touched + ROOM_TTL_MS);
    }
  }

  /** Initialise this room; false if it already exists (caller picks a new id). */
  async create(): Promise<boolean> {
    if (await this.live()) return false;
    await this.save({
      joinCounter: 0,
      participants: {},
      resultsJson: null,
      resultsVersion: 0,
      touched: 0,
    });
    return true;
  }

  /** Public snapshot of the room, or null if unknown/expired. */
  async view(): Promise<RoomView | null> {
    const room = await this.live();
    if (!room) return null;
    return {
      participants: Object.values(room.participants).sort((a, b) => a.order - b.order),
      resultsJson: room.resultsJson,
      resultsVersion: room.resultsVersion,
    };
  }

  /** Add a participant; null if the room is unknown, false if it's full. */
  async addParticipant(name: string | null): Promise<Participant | false | null> {
    const room = await this.live();
    if (!room) return null;
    if (Object.keys(room.participants).length >= MAX_PARTICIPANTS) return false;
    room.joinCounter += 1;
    const taken = new Set(Object.values(room.participants).map((p) => p.name));
    const participant: Participant = {
      id: crypto.randomUUID().replaceAll("-", "").slice(0, 16),
      order: room.joinCounter,
      name: name || randomName(taken),
      lat: null,
      lon: null,
      label: null,
    };
    room.participants[participant.id] = participant;
    await this.save(room);
    return participant;
  }

  /** Merge name/lat/lon/label into a participant; null if unknown. */
  async updateParticipant(
    pid: string,
    fields: Partial<Pick<Participant, "name" | "lat" | "lon" | "label">>
  ): Promise<Participant | null> {
    const room = await this.live();
    if (!room) return null;
    const participant = room.participants[pid];
    if (!participant) return null;
    for (const key of ["name", "lat", "lon", "label"] as const) {
      if (key in fields) {
        (participant as any)[key] = fields[key];
      }
    }
    await this.save(room);
    return participant;
  }

  /** Drop a participant (e.g. they closed the tab); null if room unknown.
   * Returns whether they were present — leaving twice is fine, which keeps
   * the unload beacon idempotent. */
  async removeParticipant(pid: string): Promise<boolean | null> {
    const room = await this.live();
    if (!room) return null;
    const found = pid in room.participants;
    if (found) {
      delete room.participants[pid];
      await this.save(room);
    }
    return found;
  }

  /** Store shared results (JSON text), returning the new version; null if
   * the room is unknown. */
  async setResults(resultsJson: string): Promise<number | null> {
    const room = await this.live();
    if (!room) return null;
    room.resultsJson = resultsJson;
    room.resultsVersion += 1;
    await this.save(room);
    return room.resultsVersion;
  }
}
