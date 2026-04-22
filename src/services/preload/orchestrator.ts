type PreloadTask = {
  name: string;
  fn: (signal: AbortSignal) => Promise<void>;
};

type PreloadCache = {
  shadow: any;
  interview: any;
  listening: any;
  dictation: any;
};

export const PreloadPipeline = {
  queue: [] as PreloadTask[],
  isProcessing: false,
  currentController: null as AbortController | null,
  cache: {
    shadow: null,
    interview: null,
    listening: null,
    dictation: null
  } as PreloadCache,

  enqueue(name: string, executeFn: (signal: AbortSignal) => Promise<void>) {
    this.queue = this.queue.filter((task) => task.name !== name);
    this.queue.push({ name, fn: executeFn });
    void this.process();
  },

  abortCurrent() {
    if (this.currentController) {
      this.currentController.abort();
      this.currentController = null;
    }
    this.queue = [];
  },

  async process() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) {
        continue;
      }

      this.currentController = new AbortController();
      try {
        console.log(`[Pipeline] 运行预载任务: ${task.name}`);
        await task.fn(this.currentController.signal);
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') {
          console.log(`[Pipeline] 任务被安全跳过: ${task.name}`);
        } else {
          console.warn(`[Pipeline] 后台任务异常中断: ${task.name}`, error);
        }
      }
      this.currentController = null;
    }

    this.isProcessing = false;
  }
};
