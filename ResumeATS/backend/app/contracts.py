from __future__ import annotations

from pydantic import BaseModel, Field


class ResumeJob(BaseModel):
    number: int
    job: str = ""
    company: str = ""
    descriptions: list[str] = Field(default_factory=list)


class ResumeExtractionResponse(BaseModel):
    target_position_title: str = ""
    executive_summary: str = ""
    skills: list[str] = Field(default_factory=list)
    experience: list[ResumeJob] = Field(default_factory=list)
    education: list[str] = Field(default_factory=list)
    clearances: list[str] = Field(default_factory=list)
    certifications: list[str] = Field(default_factory=list)
