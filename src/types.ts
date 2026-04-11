export interface Photo {
  id: string;
  title: string;
  categories: string[];
  imageUrl: string;
}

export type Category = 
  | 'All' 
  | 'Solitude & Journey' 
  | 'Resilience & Beauty' 
  | 'Urban Optimism' 
  | 'Monsoon Reverie' 
  | 'Whispering Green'
  | 'Fauna & Feathers'
  | 'Golden Hour & Silhouettes'
  | 'Nightscapes'
  | 'Concrete & Canopy'
  | 'Echoes of Faith'
  | 'Macro Details'
  | 'Vessels of Motion'
  | 'Human Tapestry'
  | 'Uncategorized';
