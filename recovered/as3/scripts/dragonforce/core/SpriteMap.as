package dragonforce.core
{
   import flash.display.BitmapData;
   
   public class SpriteMap
   {
      
      public var offX:int;
      
      public var offY:int;
      
      public var frames:Vector.<BitmapData>;
      
      public var totalFrames:int;
      
      public var loop:Boolean;
      
      public var speed:Number;
      
      public function SpriteMap()
      {
         super();
      }
   }
}

