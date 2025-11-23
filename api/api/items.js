import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  // GET: Items laden
  if (req.method === 'GET') {
    const { user_id } = req.query;
    const { data, error } = await supabase
      .from('items')
      .select('*')
      .eq('user_id', user_id)
      .order('timestamp', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  // DELETE: Item löschen
  if (req.method === 'DELETE') {
    const { id, user_id } = req.body;
    const { error } = await supabase
      .from('items')
      .delete()
      .eq('id', id)
      .eq('user_id', user_id); // Sicherheits-Check

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }
}