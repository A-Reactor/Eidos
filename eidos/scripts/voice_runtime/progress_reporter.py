"""Small atomic progress contract, independent of terminal rendering and Lightning."""
import json
import os
import time
from pathlib import Path


class ProgressReporter:
    def __init__(self, path, epochs, started_at):
        self.path = Path(path)
        self.started_at = started_at / 1000
        self.last_write = 0
        self.data = dict(phase='gpt', state='loading', epoch=0, epochs=epochs, completedEpochs=0, batch=0, batches=0)
        self.write(True)

    def write(self, force=False):
        now = time.time()
        if not force and now - self.last_write < 1:
            return
        self.data['elapsedSeconds'] = max(0, int(now - self.started_at))
        temporary = self.path.with_suffix(f'.{os.getpid()}.tmp')
        temporary.write_text(json.dumps(self.data), encoding='utf-8')
        temporary.replace(self.path)
        self.last_write = now

    def epoch_start(self, index, batches):
        self.data.update(state='training', epoch=index + 1, completedEpochs=index, batch=0, batches=batches)
        self.write(True)

    def batch_end(self, completed):
        self.data['batch'] = min(completed, self.data['batches'])
        self.write(completed >= self.data['batches'])

    def epoch_end(self, index):
        self.data.update(completedEpochs=index + 1, batch=self.data['batches'])
        self.write(True)

    def finish(self):
        self.data['state'] = 'complete'
        self.write(True)
