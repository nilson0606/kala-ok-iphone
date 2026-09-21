import unittest
import numpy as np
from reference_audio import pitch, beat_grid


class ReferenceTests(unittest.TestCase):
    def test_known_pitch_and_harmonics(self):
        t = np.arange(2048) / 16000
        for hz in [82.4069, 130.8128, 220, 440, 659.255]:
            frame = .15 * np.sin(2 * np.pi * hz * t) + .1 * np.sin(4 * np.pi * hz * t)
            detected = pitch(frame)
            self.assertIsNotNone(detected)
            self.assertLess(abs(1200 * np.log2(detected / hz)), 10)

    def test_silence_and_noise_do_not_produce_pitch(self):
        self.assertIsNone(pitch(np.zeros(2048)))
        self.assertIsNone(pitch(np.ones(2048) * .2))
        self.assertIsNone(pitch(np.random.default_rng(42).normal(0, .1, 2048)))
        self.assertEqual(beat_grid(np.zeros(16000 * 6)), (None, []))

    def test_known_click_tempo(self):
        rate = 16000
        audio = np.zeros(rate * 10)
        click = np.random.default_rng(123).normal(0, .2, 320) * np.hanning(320)
        for position in range(4000, len(audio) - len(click), 8000):
            audio[position:position + len(click)] = click
        bpm, beats = beat_grid(audio)
        self.assertAlmostEqual(bpm, 120, delta=1)
        self.assertGreater(len(beats), 15)


if __name__ == '__main__':
    unittest.main()
