type PreloadTask = {
  name: string;
  fingerprint: string;
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
  failedFingerprints: new Set<string>(),
  lastFingerprintByName: {} as Record<string, string>,
  inFlight: {} as Record<string, Promise<void> | null>,
  cache: {
    shadow: null,
    interview: null,
    listening: null,
    dictation: null
  } as PreloadCache,

  getTaskKey(name: string, fingerprint: string) {
    return `${name}:${fingerprint}`;
  },

  enqueue(
    name: string,
    fingerprint: string,
    executeFn: (signal: AbortSignal) => Promise<void>
  ) {
    const previousFingerprint = this.lastFingerprintByName[name];
    if (previousFingerprint && previousFingerprint !== fingerprint) {
      for (const key of [...this.failedFingerprints]) {
        if (key.startsWith(`${name}:`)) {
          this.failedFingerprints.delete(key);
        }
      }
    }
    this.lastFingerprintByName[name] = fingerprint;

    const taskKey = this.getTaskKey(name, fingerprint);
    if (this.failedFingerprints.has(taskKey)) {
      return;
    }

    this.queue = this.queue.filter((task) => task.name !== name);
    this.queue.push({ name, fingerprint, fn: executeFn });
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
      const taskPromise = task.fn(this.currentController.signal);
      this.inFlight[task.name] = taskPromise;

      try {
        console.log(`[Pipeline] 运行预载任务: ${task.name}`);
        await taskPromise;
        this.failedFingerprints.delete(
          this.getTaskKey(task.name, task.fingerprint)
        );
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') {
          console.log(`[Pipeline] 任务被安全跳过: ${task.name}`);
        } else {
          this.failedFingerprints.add(
            this.getTaskKey(task.name, task.fingerprint)
          );
          console.warn(`[Pipeline] 后台任务异常中断: ${task.name}`, error);
        }
      } finally {
        this.inFlight[task.name] = null;
      }
      this.currentController = null;
    }

    this.isProcessing = false;
  }
};
