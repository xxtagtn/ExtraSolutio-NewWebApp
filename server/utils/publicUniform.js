export function publicUniform(event = {}) {
  return {
    uniform: String(event.uniform || '').trim(),
    uniformNotes: String(event.uniformNotes || '').trim(),
  };
}
