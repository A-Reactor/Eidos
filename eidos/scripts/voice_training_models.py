"""Keep model switching recoverable when a load fails halfway through."""


class ModelSelection:
    def __init__(self, gpt, sovits):
        self.default = (str(gpt), str(sovits))
        self.active = None

    def apply(self, pipeline, gpt=None, sovits=None):
        if bool(gpt) != bool(sovits):
            raise ValueError('GPT 与 SoVITS 权重需要成对指定')
        selected = (gpt, sovits) if gpt else self.default
        if selected == self.active:
            return
        self.active = None
        # Prompt semantic tokens and spectrograms depend on the selected SoVITS model.
        if hasattr(pipeline, 'prompt_cache'):
            pipeline.prompt_cache = dict(ref_audio_path=None, prompt_semantic=None, refer_spec=[],
                                         prompt_text=None, prompt_lang=None, phones=None, bert_features=None,
                                         norm_text=None, aux_ref_audio_paths=[])
        pipeline.init_vits_weights(selected[1])
        # GPT's mute embedding is indexed by the SoVITS version (including Pro variants).
        pipeline.init_t2s_weights(selected[0])
        self.active = selected
