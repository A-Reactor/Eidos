"""Attach our progress callback while keeping upstream s1_train.py as the entrypoint."""
import functools
import math
import os
from pytorch_lightning import Trainer, Callback
from progress_reporter import ProgressReporter


class EidosTrainingProgress(Callback):
    def __init__(self, epochs):
        self.reporter = ProgressReporter(os.environ['EIDOS_GPT_PROGRESS'], epochs, int(os.environ['EIDOS_STAGE_STARTED_AT']))

    def on_train_epoch_start(self, trainer, _module):
        if trainer.is_global_zero:
            batches = trainer.num_training_batches
            self.reporter.epoch_start(trainer.current_epoch, int(batches) if math.isfinite(batches) else 0)

    def on_train_batch_end(self, trainer, _module, _outputs, _batch, batch_idx):
        if trainer.is_global_zero:
            self.reporter.batch_end(batch_idx + 1)

    def on_train_epoch_end(self, trainer, _module):
        if trainer.is_global_zero:
            self.reporter.epoch_end(trainer.current_epoch)
            print(f'[Eidos GPT] Epoch {trainer.current_epoch + 1}/{trainer.max_epochs} completed', flush=True)

    def on_train_end(self, trainer, _module):
        if trainer.is_global_zero:
            self.reporter.finish()


def install_training_progress():
    original = Trainer.__init__
    @functools.wraps(original)
    def initialize(self, *args, **kwargs):
        kwargs['callbacks'] = [*(kwargs.get('callbacks') or []), EidosTrainingProgress(kwargs.get('max_epochs', 1))]
        kwargs['enable_progress_bar'] = False
        return original(self, *args, **kwargs)
    Trainer.__init__ = initialize
