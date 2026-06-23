import { QueueService } from './service';

const encoder = new TextEncoder();

function sseEvent(data: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}

export class QueueController {
  static stream({ params }: any) {
    let cancelled = false;

    const readable = new ReadableStream({
      async start(controller) {
        while (!cancelled) {
          try {
            const queue = await QueueService.getBranchActiveQueueSnapshot(params.branchId);
            controller.enqueue(sseEvent({ type: 'queue_update', data: queue }));
          } catch {
            break;
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 5000));
        }
        try { controller.close(); } catch { /* already closed */ }
      },
      cancel() {
        cancelled = true;
      }
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      }
    });
  }
}
