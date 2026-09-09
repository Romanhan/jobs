// Shared drives may temporarily refuse deletion while closing file handles.
// Await cleanup before allowing the request to finish.
export async function releaseDataLock(path: string): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      await Deno.remove(path, { recursive: true });
      return;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return;
      if (attempt === 7) throw error;
      await new Promise(resolve => setTimeout(resolve, 50 * 2 ** attempt));
    }
  }
}
