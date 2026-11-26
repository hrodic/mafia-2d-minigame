// Static world drawing: buildings (pseudo-3D roofs/walls) and street props.

import { TILE_SIZE } from '../config/constants.js';
import { PropType } from '../config/enums.js';
import { ctx } from './canvas.js';


export function drawBuilding(item) {
  const { wx, wy, elev, style, hasSouthBuilding, hasEastBuilding, hasWestBuilding } = item;
  const wallHeight = elev * 10;
  const roofY = wy - wallHeight;

  if (!hasSouthBuilding) {
    ctx.fillStyle = style === 0 ? '#1e293b' : style === 1 ? '#292524' : '#1f2937';
    ctx.fillRect(wx, wy + TILE_SIZE - wallHeight, TILE_SIZE, wallHeight);

    ctx.fillStyle = 'rgba(253, 224, 71, 0.28)';
    for (let wyOff = 6; wyOff < wallHeight - 4; wyOff += 10) {
      ctx.fillRect(wx + 8, wy + TILE_SIZE - wallHeight + wyOff, 8, 5);
      ctx.fillRect(wx + 26, wy + TILE_SIZE - wallHeight + wyOff, 8, 5);
    }
  }

  ctx.fillStyle = style === 0 ? '#334155' : style === 1 ? '#44403c' : '#374151';
  ctx.fillRect(wx, roofY, TILE_SIZE, TILE_SIZE);

  ctx.strokeStyle = 'rgba(15, 23, 42, 0.55)';
  ctx.lineWidth = 1.5;
  if (!hasEastBuilding) {
    ctx.beginPath();
    ctx.moveTo(wx + TILE_SIZE, roofY);
    ctx.lineTo(wx + TILE_SIZE, roofY + TILE_SIZE);
    ctx.stroke();
  }
  if (!hasWestBuilding) {
    ctx.beginPath();
    ctx.moveTo(wx, roofY);
    ctx.lineTo(wx, roofY + TILE_SIZE);
    ctx.stroke();
  }
}

export function drawProp(item) {
  const { wx, wy, prop, color, vertical, curbSide } = item;
  if (prop === PropType.CAR) {
    const rx = vertical ? (curbSide === 'W' ? wx + 21 : wx + 5) : wx + 5;
    const ry = vertical ? wy + 5 : (curbSide === 'N' ? wy + 21 : wy + 5);
    const rw = vertical ? 18 : 34;
    const rh = vertical ? 34 : 18;

    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.fillRect(rx + 2, ry + 3, rw, rh);

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(rx, ry, rw, rh, 4);
    ctx.fill();

    ctx.fillStyle = 'rgba(148, 163, 184, 0.45)';
    if (vertical) {
      ctx.fillRect(rx + 3, ry + 6, rw - 6, 6);
      ctx.fillRect(rx + 3, ry + rh - 11, rw - 6, 5);
    } else {
      ctx.fillRect(rx + 6, ry + 3, 6, rh - 6);
      ctx.fillRect(rx + rw - 11, ry + 3, 5, rh - 6);
    }
  } else if (prop === PropType.DUMPSTER) {
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.fillRect(wx + 11, wy + 13, 26, 22);
    ctx.fillStyle = '#14532d';
    ctx.fillRect(wx + 9, wy + 10, 26, 22);
    ctx.fillStyle = '#09090b';
    ctx.fillRect(wx + 10, wy + 11, 24, 6);
  } else if (prop === PropType.STREETLIGHT) {
    ctx.fillStyle = '#52525b';
    ctx.fillRect(wx + 20, wy + 4, 4, 24);
    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.arc(wx + 22, wy + 4, 3.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (prop === PropType.TREE) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(wx + 22, wy + 28, 11, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#713f12';
    ctx.fillRect(wx + 20, wy + 16, 4, 12);
    ctx.fillStyle = '#15803d';
    ctx.beginPath();
    ctx.arc(wx + 22, wy + 13, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#166534';
    ctx.beginPath();
    ctx.arc(wx + 19, wy + 11, 7, 0, Math.PI * 2);
    ctx.fill();
  }
}
