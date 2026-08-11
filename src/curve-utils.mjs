export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const snap = (value, step, min = 0) => Math.round((value - min) / step) * step + min;

export function resizePoints(points, hours) {
  const result = points.filter((point) => point.offset_minutes < hours * 60).map((point) => ({...point}));
  const lastTemperature = result.at(-1)?.temperature ?? 26;
  for (let hour = 0; hour < hours; hour += 1) {
    if (!result.some((point) => point.offset_minutes === hour * 60)) {
      result.push({offset_minutes: hour * 60, temperature: lastTemperature});
    }
  }
  return result.sort((a, b) => a.offset_minutes - b.offset_minutes);
}

export function recommendation(hours, start, preference = "comfort") {
  const templates = {
    comfort: [0, 0, .5, 1, 1.5, 1.5, 1, .5],
    energy_saving: [0, .5, 1, 1.5, 2, 2, 1.5, 1],
    cooler: [0, 0, .5, .5, 1, 1, .5, 0],
  };
  return Array.from({length: hours}, (_, index) => {
    const templateIndex = Math.round(index * 7 / Math.max(1, hours - 1));
    return {offset_minutes: index * 60, temperature: snap(start + templates[preference][templateIndex], .5)};
  });
}

