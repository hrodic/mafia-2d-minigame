// Spatial hashes: chunk buckets for AI perception (3x3 chunk queries) and a
// finer 64 px grid for collision broad-phase.

import { CHUNK_PX } from '../config/constants.js';
import { packChunkKey } from '../world/city.js';
import { state } from './state.js';

export const COLLISION_CELL_PX = 64;

export function packCollisionCell(cx, cy) {
  return ((cx + 2048) << 12) | (cy + 2048);
}

export function rebuildSpatialBuckets(
  npcs = state.npcs,
  spatialBuckets = state.spatialBuckets,
  bucketPool = state.bucketPool
) {
  for (const bucket of spatialBuckets.values()) {
    bucket.length = 0;
    bucketPool.push(bucket);
  }
  spatialBuckets.clear();

  for (let i = 0; i < npcs.length; i++) {
    const unit = npcs[i];
    const cx = Math.floor(unit.x / CHUNK_PX);
    const cy = Math.floor(unit.y / CHUNK_PX);
    const key = packChunkKey(cx, cy);
    let bucket = spatialBuckets.get(key);
    if (!bucket) {
      bucket = bucketPool.pop() || [];
      spatialBuckets.set(key, bucket);
    }
    bucket.push(unit);
  }
}

export function rebuildCollisionBuckets(
  npcs = state.npcs,
  collisionBuckets = state.collisionBuckets,
  collisionBucketPool = state.collisionBucketPool
) {
  for (const bucket of collisionBuckets.values()) {
    bucket.length = 0;
    collisionBucketPool.push(bucket);
  }
  collisionBuckets.clear();

  for (let i = 0; i < npcs.length; i++) {
    addUnitToCollisionBucket(npcs[i], collisionBuckets, collisionBucketPool);
  }
}

export function addUnitToCollisionBucket(
  unit,
  collisionBuckets = state.collisionBuckets,
  collisionBucketPool = state.collisionBucketPool
) {
  if (!unit) return;
  const cx = Math.floor(unit.x / COLLISION_CELL_PX);
  const cy = Math.floor(unit.y / COLLISION_CELL_PX);
  const key = packCollisionCell(cx, cy);
  let bucket = collisionBuckets.get(key);
  if (!bucket) {
    bucket = collisionBucketPool.pop() || [];
    collisionBuckets.set(key, bucket);
  }
  bucket.push(unit);
}

