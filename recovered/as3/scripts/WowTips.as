package
{
   import flash.display.DisplayObjectContainer;
   import flash.display.Sprite;
   import flash.events.DataEvent;
   import flash.events.Event;
   import flash.events.MouseEvent;
   import flash.text.TextField;
   import flash.text.TextFormat;
   import flash.utils.Dictionary;
   
   public class WowTips extends Sprite
   {
      
      private static var instance:WowTips;
      
      public static var TIPS:String = "tips";
      
      private var tipsDict:Dictionary = new Dictionary();
      
      private var tt:TextField = new TextField();
      
      public function WowTips(param1:DisplayObjectContainer = null)
      {
         super();
         if(!instance)
         {
            instance = this;
            addEventListener(Event.ADDED_TO_STAGE,this.init);
            if(param1)
            {
               param1.addChild(this);
            }
            addChild(this.tt);
            visible = false;
            mouseChildren = false;
            mouseEnabled = false;
            var _loc2_:TextFormat = new TextFormat("Verdana");
            this.tt.defaultTextFormat = _loc2_;
            this.tt.wordWrap = true;
            this.tt.autoSize = "left";
            this.tt.width = 200;
            this.tt.x = 8;
            this.tt.y = 8;
            this.tt.multiline = true;
            return;
         }
      }
      
      private function init(param1:Event) : *
      {
         stage.addChild(this);
         stage.addEventListener(TIPS,this.tipsHandle);
      }
      
      private function tipsHandle(param1:DataEvent) : void
      {
         param1.target.addEventListener(MouseEvent.ROLL_OVER,this.mouseHandle);
         param1.target.addEventListener(Event.REMOVED_FROM_STAGE,this.removed);
         this.tipsDict[param1.target] = param1.data;
         if(visible)
         {
            this.draw(param1.target);
         }
      }
      
      private function removed(param1:Event) : void
      {
         param1.target.removeEventListener(MouseEvent.ROLL_OVER,this.mouseHandle);
         param1.target.removeEventListener(Event.REMOVED_FROM_STAGE,this.removed);
         delete this.tipsDict[param1.target];
      }
      
      private function mouseHandle(param1:MouseEvent) : void
      {
         switch(param1.type)
         {
            case MouseEvent.ROLL_OVER:
               param1.target.addEventListener(MouseEvent.ROLL_OUT,this.mouseHandle);
               stage.addEventListener(MouseEvent.MOUSE_MOVE,this.mouseHandle);
               this.draw(param1.target);
               break;
            case MouseEvent.ROLL_OUT:
               param1.target.removeEventListener(MouseEvent.ROLL_OUT,this.mouseHandle);
               stage.removeEventListener(MouseEvent.MOUSE_MOVE,this.mouseHandle);
               graphics.clear();
               visible = false;
               break;
            case MouseEvent.MOUSE_MOVE:
               visible = true;
               y = stage.mouseY - 10;
               if(y > stage.stageHeight - this.tt.textHeight - 25)
               {
                  y = stage.stageHeight - this.tt.textHeight - 25;
               }
               if(stage.mouseX + this.tt.textWidth + 20 < stage.stageWidth)
               {
                  x = stage.mouseX + 35;
               }
               else
               {
                  x = stage.mouseX - (35 + this.tt.textWidth + 20);
               }
         }
      }
      
      private function draw(param1:Object) : void
      {
         this.tt.htmlText = this.tipsDict[param1];
         graphics.clear();
         graphics.lineStyle(1,15724527,0.8);
         graphics.beginFill(921102,0.85);
         graphics.drawRoundRect(0,0,this.tt.textWidth + 20,this.tt.textHeight + 20,6,6);
         graphics.endFill();
      }
   }
}

