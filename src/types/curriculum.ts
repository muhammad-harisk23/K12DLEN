export type VerificationStatus = 'draft' | 'verified' | 'published';

export interface Board {
  id: string;
  code: string;
  name: string;
}

export interface SyllabusVersion {
  id: string;
  board_id: string;
  label: string;
  is_current: boolean;
  published: boolean;
}

export interface ClassRow {
  id: string;
  syllabus_version_id: string;
  level: number;
  label: string;
  qualification: string | null;
  syllabus_versions: { board_id: string; published: boolean };
}

export interface Subject {
  id: string;
  class_id: string;
  name: string;
  slug: string;
  topic_grouping: { name: string; color: string }[];
  display_order: number;
}

export interface Chapter {
  id: string;
  subject_id: string;
  code: string;
  title: string;
  display_order: number;
  verification_status: VerificationStatus;
}

export interface StudentProfile {
  id: string;
  display_name: string;
  board_id: string | null;
  class_id: string | null;
  focused_subject_id: string | null;
  onboarded_at: string | null;
  created_at: string;
  updated_at: string;
}
