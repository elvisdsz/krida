export function distance3DSquared(
  p1: { x: number; y: number; z: number },
  p2: { x: number; y: number; z: number },
): number {
  return (p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2 + (p1.z - p2.z) ** 2;
}

export function distance3D(
  p1: { x: number; y: number; z: number },
  p2: { x: number; y: number; z: number },
): number {
  return Math.sqrt(distance3DSquared(p1, p2));
}

export function centroid3D(points: { x: number; y: number; z: number }[]): {
  x: number;
  y: number;
  z: number;
} {
  const n = points.length;
  if (n === 0) {
    throw new RangeError("centroid3D: points array must not be empty");
  }
  const sum = points.reduce(
    (acc, p) => {
      acc.x += p.x;
      acc.y += p.y;
      acc.z += p.z;
      return acc;
    },
    { x: 0, y: 0, z: 0 },
  );
  return { x: sum.x / n, y: sum.y / n, z: sum.z / n };
}
