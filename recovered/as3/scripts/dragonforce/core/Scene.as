package dragonforce.core
{
   import flash.display.BitmapData;
   import flash.display.Sprite;
   
   public class Scene extends Sprite
   {
      
      public var grounds:Vector.<GroundTile> = new Vector.<GroundTile>();
      
      public var bg1BitmapData:BitmapData;
      
      public var bg2BitmapData:BitmapData;
      
      public function Scene()
      {
         super();
      }
      
      public function addGroundTile(param1:GroundTile) : void
      {
         this.grounds.push(param1);
      }
      
      public function step() : void
      {
         var _loc1_:Symbol = null;
         var _loc2_:int = 0;
         while(_loc2_ < numChildren)
         {
            _loc1_ = getChildAt(_loc2_) as Symbol;
            _loc1_.step();
            _loc2_++;
         }
      }
   }
}

