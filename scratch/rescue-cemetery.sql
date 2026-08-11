-- One-time rescue: restore top 50% of cemetery movies (by vote count) to active proposals.
-- Run once in Supabase Dashboard SQL editor.
WITH vote_counts AS (
  SELECT movie_id, COUNT(*) AS vote_count
  FROM votes
  GROUP BY movie_id
),
cemetery_with_votes AS (
  SELECT m.id, COALESCE(vc.vote_count, 0) AS vote_count
  FROM movies m
  LEFT JOIN vote_counts vc ON vc.movie_id = m.id
  WHERE m.is_dropped = true
    AND m.is_seen  = false
    AND COALESCE(vc.vote_count, 0) > 0
),
ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (ORDER BY vote_count DESC) AS rn,
    COUNT(*)     OVER ()                          AS total
  FROM cemetery_with_votes
)
UPDATE movies
SET is_dropped = false
WHERE id IN (
  SELECT id FROM ranked WHERE rn <= CEIL(total::float / 2)
);
