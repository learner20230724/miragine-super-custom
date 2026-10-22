package
{
   import flash.display.BitmapData;
   
   [Embed(source="/_assets/14_terrain.jpg")]
   public dynamic class terrain extends BitmapData
   {
      
      public function terrain(param1:int = 8000, param2:int = 300)
      {
         super(param1,param2);
      }
   }
}

