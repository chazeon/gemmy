"""Compile pipeline: structure + config -> SceneDocument, as small pure stages.

Stages take plain data and return plain data. The only mutable state lives in
`PointTable` (point dedup) and `SceneAssembler` (primitive emission order).
"""
