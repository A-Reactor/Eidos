"""Select a local inference device and recover from accelerator incompatibilities."""


class VoiceInferenceRuntime:
    def __init__(self, torch, factory, requested='auto'):
        requested = requested.strip().lower()
        if requested not in ('auto', 'cpu', 'cuda', 'mps'):
            raise ValueError('MOMOI_DEVICE 须为 auto、cpu、cuda 或 mps')
        available = dict(cpu=True, cuda=torch.cuda.is_available(),
                         mps=bool(getattr(torch.backends, 'mps', None) and torch.backends.mps.is_available()))
        if requested != 'auto' and not available[requested]:
            raise ValueError(f'当前 Python 环境无法使用 {requested.upper()}，请检查 PyTorch 或设置 MOMOI_DEVICE=cpu')
        self.requested = requested
        self.device = next(device for device in ('cuda', 'mps', 'cpu') if available[device]) if requested == 'auto' else requested
        self.factory = factory
        self.pipeline = None
        self.fallback_reason = ''

    @property
    def is_half(self):
        # MPS uses float32; enabling half precision can change output or break operators.
        return self.device == 'cuda'

    def run(self, operation):
        try:
            if self.pipeline is None:
                self.pipeline = self.factory(self.device, self.is_half)
            return operation(self.pipeline)
        except Exception as error:
            message = str(error).lower()
            backend_error = isinstance(error, NotImplementedError) or any(
                marker in message for marker in ('mps', 'metal', 'cuda', 'cudnn', 'cublas'))
            if self.device == 'cpu' or not isinstance(error, (RuntimeError, NotImplementedError)) or not backend_error:
                raise
            self.fallback_reason = f'{self.device.upper()} 加速异常，已回退 CPU：{error}'
            self.device = 'cpu'
            self.pipeline = None
        # Build a fresh CPU pipeline: upstream set_device does not move every auxiliary model.
        # Retry outside the handler so a second failure is surfaced rather than looped.
        self.pipeline = self.factory('cpu', False)
        return operation(self.pipeline)
