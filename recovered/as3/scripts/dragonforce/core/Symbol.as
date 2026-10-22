package dragonforce.core
{
   import flash.display.Bitmap;
   import flash.display.Sprite;
   
   public class Symbol extends Sprite
   {
      
      public var px:Number = 0;
      
      public var py:Number = 0;
      
      public var pz:Number = 0;
      
      public var sx:Number = 1;
      
      public var sy:Number = 1;
      
      public var scene:Scene;
      
      public var prev:Symbol;
      
      public var next:Symbol;
      
      public var spriteMap:SpriteMap;
      
      public var spriteSheet:SpriteSheet;
      
      public var canvas:Bitmap = new Bitmap();
      
      public var currentRow:int;
      
      public var currentFrame:Number;
      
      public function Symbol()
      {
         super();
         addChild(this.canvas);
      }
      
      public function gotoAndPlay(param1:String) : void
      {
         if(this.spriteSheet == null)
         {
            return;
         }
         var _loc2_:SpriteMap = this.spriteSheet.map(param1);
         if(_loc2_ == null)
         {
            return;
         }
         if(_loc2_ == this.spriteMap && this.spriteMap.loop)
         {
            return;
         }
         this.spriteMap = _loc2_;
         this.canvas.x = _loc2_.offX;
         this.canvas.y = _loc2_.offY;
         this.currentFrame = 1;
         this.canvas.bitmapData = this.spriteMap.frames[int(this.currentRow * this.spriteMap.totalFrames + this.currentFrame)];
      }
      
      public function destroy() : void
      {
         this.scene.removeChild(this);
      }
      
      public function step() : void
      {
         if(this.spriteMap)
         {
            this.canvas.bitmapData = this.spriteMap.frames[int(this.currentRow * this.spriteMap.totalFrames + this.currentFrame)];
            if(this.currentFrame >= this.spriteMap.totalFrames - this.spriteMap.speed + 1 - 0.001)
            {
               if(this.spriteMap.loop)
               {
                  this.currentFrame = 1;
               }
            }
            else
            {
               this.currentFrame += this.spriteMap.speed;
            }
         }
      }
   }
}

