export interface Skill {
  name: string;
  description: string;
  content?: string;
  read_when?: string[] | null;
}

export interface SaveSkillInput {
  name: string;
  description?: string;
  read_when?: string[] | null;
  content: string;
}

export interface LearnedSkill extends Skill {
  id: string;
  enabled: boolean;
  learned_at: string;
}