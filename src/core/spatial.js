// Spatial hash of entities grouped by district chunk (3x3 neighbourhood queries).

import { CHUNK_PX } from '../config/constants.js';
import { packChunkKey } from '../world/city.js';
import { state } from './state.js';

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

